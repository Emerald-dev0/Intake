const commands = [
  'Create a student registration form.',
  'Create a research questionnaire.',
  'Add an accommodation question if they answer yes.',
  'Make email required.',
  'Change the options for level.',
  'Change the title or description.',
  'Make a version for another event.',
];

export function ExampleCommands() {
  return (
    <div className="example-commands">
      <div className="edits-cmds">
        {commands.map(command => <span className="edits-cmd" key={command}>“{command}”</span>)}
      </div>
      <p>Examples of what Intake is designed to support. Editing and provider connections are not live yet.</p>
    </div>
  );
}
