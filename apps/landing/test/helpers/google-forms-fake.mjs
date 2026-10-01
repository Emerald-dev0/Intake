/**
 * A stateful stand-in for the Google Forms API v1, used at the HTTP boundary of the adapter tests.
 *
 * It is not canned output. It keeps a form, applies batchUpdate the way the API documents it, and
 * rejects what the API rejects, so a wrong request from the adapter fails the test instead of passing
 * by coincidence. Constraints encoded (each from the Forms API reference, Discovery revision 20260922,
 * or the guides on developers.google.com/workspace/forms):
 *   - forms.create copies only info.title and info.documentTitle; anything else is refused;
 *   - forms.create?unpublished=true creates a form that does not accept responses. Without the
 *     parameter this fake publishes (the pre-2026-06-30 behaviour) so an adapter that forgot the
 *     parameter would be caught leaving a half-built form live;
 *   - sub-requests are validated one at a time in order, so location.index must be valid at that
 *     moment and goToSectionId must name a section header that already exists. A normal successful
 *     fake batch is applied as a unit for simplicity, but the real API's atomicity is not assumed:
 *     injected failures can apply a prefix and are used to test partial-outcome recovery;
 *   - updateFormInfo needs an updateMask;
 *   - a pageBreakItem is an empty object, and a form cannot start with one (assumed, to be safe);
 *   - deleteItem needs a location that points at an existing item;
 *   - only RADIO and DROP_DOWN options may route;
 *   - setPublishSettings needs publishSettings.publishState with both booleans, and
 *     isAcceptingResponses=true with isPublished=false is an error.
 */

export const FAKE_TOKEN = 'ACCESS_TOKEN_FOR_TESTS';

const ROUTE = /^\/v1\/forms(?:\/([^/:]+):(batchUpdate|setPublishSettings))?$/;
const FORM_GET_ROUTE = /^\/v1\/forms\/([^/:]+)$/;

export function createFakeGoogleForms(options = {}) {
  const acceptedTokens = new Set(options.tokens ?? [options.token ?? FAKE_TOKEN]);
  const forms = new Map();
  const calls = [];
  const failures = [];
  let formCounter = 0;
  let itemCounter = 0;

  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const problem = (status, googleStatus, message, reason, headers) =>
    json(status, { error: { code: status, message, status: googleStatus, ...(reason ? { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'googleapis.com' }] } : {}) } }, headers);
  const invalid = message => problem(400, 'INVALID_ARGUMENT', message);
  const nextItemId = () => (++itemCounter).toString(16).padStart(8, '0');

  function failure(operation) {
    const index = failures.findIndex(item => item.operation === operation && item.skip === 0);
    for (const item of failures) if (item.operation === operation && item.skip > 0) item.skip -= 1;
    if (index < 0) return null;
    const [spec] = failures.splice(index, 1);
    return spec;
  }

  function applyBatch(form, requests) {
    const items = structuredClone(form.items);
    const info = { ...form.info };
    const replies = [];
    for (const [position, request] of requests.entries()) {
      const where = `requests[${position}]`;
      const kinds = Object.keys(request);
      if (kinds.length !== 1) return { error: invalid(`${where}: exactly one request kind is required`) };
      const [kind] = kinds;
      const body = request[kind];
      if (kind === 'updateFormInfo') {
        if (!body.info || typeof body.updateMask !== 'string' || !body.updateMask) return { error: invalid(`${where}.updateFormInfo: info and updateMask are required`) };
        for (const field of body.updateMask.split(',')) {
          if (field === 'documentTitle') return { error: invalid(`${where}: documentTitle cannot be updated by batchUpdate`) };
          if (!['title', 'description'].includes(field)) return { error: invalid(`${where}: unsupported updateMask ${field}`) };
          info[field] = body.info[field];
        }
        replies.push({});
      } else if (kind === 'createItem') {
        const { item, location } = body;
        if (!item || !location || !Number.isInteger(location.index)) return { error: invalid(`${where}.createItem.location.index is invalid or was not provided`) };
        if (location.index < 0 || location.index > items.length) return { error: invalid(`${where}.createItem.location.index ${location.index} is out of range for a form with ${items.length} items`) };
        const kindsOfItem = ['questionItem', 'pageBreakItem', 'textItem', 'imageItem', 'videoItem', 'questionGroupItem'].filter(key => item[key] !== undefined);
        if (kindsOfItem.length !== 1) return { error: invalid(`${where}: an item must be exactly one kind`) };
        if (item.title !== undefined && typeof item.title !== 'string') return { error: invalid(`${where}: title must be a string`) };
        const created = { ...structuredClone(item), itemId: nextItemId() };
        const reply = { itemId: created.itemId };
        if (created.pageBreakItem !== undefined) {
          if (Object.keys(created.pageBreakItem).length !== 0) return { error: invalid(`${where}: pageBreakItem has no fields`) };
          if (location.index === 0) return { error: invalid(`${where}: a form cannot start with a page break`) };
        } else if (created.questionItem) {
          const question = created.questionItem.question;
          if (!question) return { error: invalid(`${where}: questionItem.question is required`) };
          const questionKinds = ['choiceQuestion', 'textQuestion', 'scaleQuestion', 'dateQuestion', 'timeQuestion', 'ratingQuestion'].filter(key => question[key] !== undefined);
          if (questionKinds.length !== 1) return { error: invalid(`${where}: a question must be exactly one kind`) };
          if (question.choiceQuestion) {
            const choice = question.choiceQuestion;
            if (!['RADIO', 'CHECKBOX', 'DROP_DOWN'].includes(choice.type)) return { error: invalid(`${where}: choiceQuestion.type is required`) };
            if (!Array.isArray(choice.options) || choice.options.length === 0) return { error: invalid(`${where}: choiceQuestion.options is required`) };
            for (const option of choice.options) {
              if (typeof option.value !== 'string' || !option.value) return { error: invalid(`${where}: option.value is required`) };
              const routes = option.goToSectionId !== undefined || option.goToAction !== undefined;
              if (option.goToSectionId !== undefined && option.goToAction !== undefined) return { error: invalid(`${where}: an option has either goToSectionId or goToAction`) };
              if (routes && choice.type === 'CHECKBOX') return { error: invalid(`${where}: checkbox options cannot route`) };
              if (option.goToAction !== undefined && !['NEXT_SECTION', 'RESTART_FORM', 'SUBMIT_FORM'].includes(option.goToAction)) return { error: invalid(`${where}: unknown goToAction`) };
              if (option.goToSectionId !== undefined && !items.some(existing => existing.itemId === option.goToSectionId && existing.pageBreakItem)) {
                return { error: invalid(`${where}: goToSectionId ${option.goToSectionId} is not an existing section header`) };
              }
            }
          }
          created.questionItem.question.questionId = nextItemId();
          reply.questionId = [created.questionItem.question.questionId];
        }
        items.splice(location.index, 0, created);
        replies.push({ createItem: reply });
      } else if (kind === 'updateItem') {
        const index = body?.location?.index;
        const patch = body?.item;
        if (!Number.isInteger(index) || index < 0 || index >= items.length || !patch || patch.itemId !== items[index].itemId || typeof body.updateMask !== 'string' || !body.updateMask) {
          return { error: invalid(`${where}.updateItem requires the existing item id, location and updateMask`) };
        }
        for (const path of body.updateMask.split(',')) {
          const parts = path.split('.');
          let source = patch;
          let destination = items[index];
          for (let offset = 0; offset < parts.length - 1; offset += 1) {
            source = source?.[parts[offset]];
            destination[parts[offset]] ??= {};
            destination = destination[parts[offset]];
          }
          const leaf = parts.at(-1);
          if (source?.[leaf] === undefined) return { error: invalid(`${where}.updateItem is missing masked field ${path}`) };
          destination[leaf] = structuredClone(source[leaf]);
        }
        replies.push({});
      } else if (kind === 'moveItem') {
        const original = body?.originalLocation?.index;
        const next = body?.newLocation?.index;
        if (!Number.isInteger(original) || original < 0 || original >= items.length || !Number.isInteger(next)) return { error: invalid(`${where}.moveItem locations are invalid`) };
        const [moved] = items.splice(original, 1);
        if (next < 0 || next > items.length) return { error: invalid(`${where}.moveItem destination is out of range`) };
        items.splice(next, 0, moved);
        replies.push({});
      } else if (kind === 'deleteItem') {
        const index = body?.location?.index;
        if (!Number.isInteger(index) || index < 0 || index >= items.length) return { error: invalid(`${where}.deleteItem.location.index ${index} does not point at an item`) };
        items.splice(index, 1);
        replies.push({});
      } else {
        return { error: invalid(`${where}: unsupported request kind ${kind}`) };
      }
    }
    return { items, info, replies };
  }

  async function fetchLike(input, init = {}) {
    const url = new URL(input);
    const headers = new Headers(init.headers);
    const body = init.body ? JSON.parse(init.body) : undefined;
    const trustedOrigin = url.origin === 'https://forms.googleapis.com';
    const getMatch = trustedOrigin && init.method === 'GET' ? FORM_GET_ROUTE.exec(url.pathname) : null;
    const match = trustedOrigin ? ROUTE.exec(url.pathname) : null;
    const operation = getMatch ? 'forms.get' : !match ? 'unknown' : !match[1] ? 'forms.create' : match[2] === 'batchUpdate' ? 'forms.batchUpdate' : 'forms.setPublishSettings';
    calls.push({
      operation,
      method: init.method,
      url: url.toString(),
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      authorization: headers.get('authorization'),
      contentType: headers.get('content-type'),
      redirect: init.redirect,
      hasSignal: !!init.signal,
      body: body === undefined ? undefined : structuredClone(body),
    });
    if ((!match && !getMatch) || (getMatch ? init.method !== 'GET' : init.method !== 'POST')) return problem(404, 'NOT_FOUND', 'Not found');
    if (!acceptedTokens.has((headers.get('authorization') ?? '').replace(/^Bearer /, ''))) return problem(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.');

    const injected = failure(operation);
    if (injected?.network) throw new TypeError('fetch failed');
    if (injected?.timeout) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    if (injected?.respond) return json(injected.respond.status ?? 200, injected.respond.body, injected.respond.headers);
    if (injected?.status && !injected.applyThenDrop && injected.partialAfter === undefined) {
      return problem(injected.status, injected.googleStatus ?? 'UNKNOWN', injected.message ?? 'injected failure', injected.reason, injected.headers);
    }

    let response;
    if (operation === 'forms.get') {
      const form = forms.get(getMatch[1]);
      if (!form) return problem(404, 'NOT_FOUND', 'Requested entity was not found.');
      response = json(200, { formId: form.formId, revisionId: form.revisionId, info: form.info, responderUri: form.responderUri,
        settings: { quizSettings: { isQuiz: form.isQuiz ?? false } }, items: form.items });
    } else if (operation === 'forms.create') {
      const extra = Object.keys(body ?? {}).filter(key => key !== 'info');
      if (extra.length || !body?.info || typeof body.info.title !== 'string' || !body.info.title) return invalid('info.title is required and only info is accepted');
      if (Object.keys(body.info).some(key => !['title', 'documentTitle'].includes(key))) return invalid('Only info.title and info.documentTitle are copied on create');
      formCounter += 1;
      const formId = `1FAfakeForm${String(formCounter).padStart(4, '0')}abcdefghijklmnop`;
      const unpublished = url.searchParams.get('unpublished') === 'true';
      const form = {
        formId,
        info: { title: body.info.title, documentTitle: body.info.documentTitle ?? 'Untitled form' },
        items: [],
        revisionId: '00000001',
        responderUri: options.responderUri ? options.responderUri(formCounter) : `https://docs.google.com/forms/d/e/1FAIpQLSfake${formCounter}/viewform`,
        isQuiz: false,
        publishState: { isPublished: !unpublished, isAcceptingResponses: !unpublished },
      };
      forms.set(formId, form);
      response = json(200, { formId, info: form.info, revisionId: form.revisionId, responderUri: form.responderUri, publishSettings: { publishState: form.publishState } });
    } else {
      const formId = getMatch?.[1] ?? match[1];
      const form = forms.get(formId);
      if (!form) return problem(404, 'NOT_FOUND', 'Requested entity was not found.');
      if (operation === 'forms.batchUpdate') {
        if (!Array.isArray(body?.requests) || body.requests.length === 0) return invalid('requests is required');
        if (body.writeControl?.requiredRevisionId && body.writeControl.requiredRevisionId !== form.revisionId) {
          return problem(400, 'FAILED_PRECONDITION', 'The form revision did not match the required revision.');
        }
        if (Number.isInteger(injected?.partialAfter)) {
          const count = Math.max(0, Math.min(body.requests.length, injected.partialAfter));
          const partial = applyBatch(form, body.requests.slice(0, count));
          if (partial.error) return partial.error;
          form.items = partial.items;
          form.info = partial.info;
          form.revisionId = String(Number(form.revisionId) + 1).padStart(8, '0');
          response = problem(injected.status ?? 500, injected.googleStatus ?? 'INTERNAL', injected.message ?? 'injected partial batch failure');
        } else {
          const applied = applyBatch(form, body.requests);
          if (applied.error) return applied.error;
          form.items = applied.items;
          form.info = applied.info;
          form.revisionId = String(Number(form.revisionId) + 1).padStart(8, '0');
          response = json(200, { replies: applied.replies, writeControl: { requiredRevisionId: form.revisionId } });
        }
      } else {
        const state = body?.publishSettings?.publishState;
        if (!state || typeof state.isPublished !== 'boolean' || typeof state.isAcceptingResponses !== 'boolean') {
          return invalid('publishSettings.publishState with isPublished and isAcceptingResponses is required');
        }
        if (state.isAcceptingResponses && !state.isPublished) return invalid('isAcceptingResponses cannot be true when isPublished is false');
        form.publishState = { isPublished: state.isPublished, isAcceptingResponses: state.isPublished ? state.isAcceptingResponses : false };
        response = json(200, { formId: form.formId, publishSettings: { publishState: form.publishState } });
      }
    }
    if (injected?.applyThenDrop) throw new TypeError('fetch failed');
    return response;
  }

  return {
    fetch: fetchLike,
    calls,
    forms,
    token: [...acceptedTokens][0],
    acceptToken(value) {
      acceptedTokens.add(value);
    },
    revokeToken(value) {
      acceptedTokens.delete(value);
    },
    /** Make the next call to `operation` fail. `skip` lets that many calls through first. */
    failOn(operation, spec, skip = 0) {
      failures.push({ operation, skip, ...spec });
    },
    callsTo(operation) {
      return calls.filter(call => call.operation === operation);
    },
    lastForm() {
      return [...forms.values()].at(-1);
    },
    mutateForm(formId, mutate) {
      const form = forms.get(formId);
      if (!form) throw new Error('unknown fake form');
      mutate(form);
      form.revisionId = String(Number(form.revisionId) + 1).padStart(8, '0');
      return form;
    },
  };
}

/**
 * Walks a Google form the way the documented navigation works and returns the question titles a
 * respondent sees. Sections start at page breaks. After a section the respondent goes to the next one
 * unless a chosen option routes elsewhere. `answers` maps a question title to the chosen option.
 */
export function simulateRespondent(items, answers) {
  const sections = [];
  let current = { header: null, items: [] };
  for (const item of items) {
    if (item.pageBreakItem) {
      sections.push(current);
      current = { header: item.itemId, items: [] };
    } else {
      current.items.push(item);
    }
  }
  sections.push(current);

  const shown = [];
  let position = 0;
  let steps = 0;
  while (position < sections.length) {
    if (++steps > sections.length * 4 + 4) throw new Error('navigation loops');
    let next = position + 1;
    for (const item of sections[position].items) {
      shown.push(item.title);
      const choice = item.questionItem?.question?.choiceQuestion;
      const answer = answers[item.title];
      if (!choice || answer === undefined) continue;
      const option = choice.options.find(candidate => candidate.value === answer);
      if (option?.goToSectionId) {
        const target = sections.findIndex(section => section.header === option.goToSectionId);
        if (target < 0) throw new Error('route points at a missing section');
        next = target;
      } else if (option?.goToAction === 'SUBMIT_FORM') {
        next = sections.length;
      } else if (option?.goToAction === 'RESTART_FORM') {
        next = 0;
      }
    }
    position = next;
  }
  return shown;
}

/** What the specification says a respondent should see, independent of any provider. */
export function expectedVisibleTitles(specification, answers) {
  const titleById = new Map(specification.questions.map(question => [question.id, question.title]));
  return specification.questions
    .filter(question => {
      if (!question.visibility) return true;
      const { question: source, equals } = question.visibility.when;
      return answers[titleById.get(source)] === equals;
    })
    .map(question => question.title);
}

/** Every combination of answers to the questions that control others. */
export function answerCombinations(specification) {
  const controllers = specification.questions.filter(question => specification.questions.some(other => other.visibility?.when.question === question.id));
  let combos = [{}];
  for (const controller of controllers) {
    combos = combos.flatMap(combo => controller.options.map(option => ({ ...combo, [controller.title]: option })));
  }
  return combos;
}
