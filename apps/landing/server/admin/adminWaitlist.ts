import { db } from './../db';
import { waitlist } from './../dbSchema';
import { eq } from 'drizzle-orm';

export async function fetchWaitlist() {
  return await db.select({
    id: waitlist.id,
    email: waitlist.email,
    createdAt: waitlist.created_at,
  }).from(waitlist).orderBy(waitlist.created_at.desc);
}

export async function removeWaitlist(id: string) {
  await db.delete(waitlist).where(eq(waitlist.id, id));
}