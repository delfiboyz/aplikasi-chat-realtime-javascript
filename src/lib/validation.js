import { z } from 'zod';

export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉'];
export const MAX_MESSAGE_LENGTH = 4000;

const id = z.string().trim().min(1).max(64);

export const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_]{3,20}$/, 'Username 3-20 karakter: huruf, angka, atau underscore'),
  password: z.string().min(8, 'Password minimal 8 karakter').max(128, 'Password terlalu panjang'),
});

const messageText = z
  .string()
  .trim()
  .min(1, 'Pesan tidak boleh kosong')
  .max(MAX_MESSAGE_LENGTH, `Pesan maksimal ${MAX_MESSAGE_LENGTH} karakter`);

export const schemas = {
  roomId: z.object({ roomId: id }),
  history: z.object({ roomId: id, before: id.optional() }),
  sendMessage: z.object({ roomId: id, text: messageText, replyTo: id.optional() }),
  editMessage: z.object({ id, text: messageText }),
  messageId: z.object({ id }),
  react: z.object({ id, emoji: z.enum(REACTIONS) }),
  typing: z.object({ roomId: id, isTyping: z.boolean() }),
  createRoom: z.object({
    name: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]{2,32}$/, 'Nama channel 2-32 karakter: huruf kecil, angka, atau tanda hubung'),
  }),
  openDm: z.object({ userId: id }),
};

/** Parse input and return either `{ data }` or `{ error }` with a readable message. */
export function parse(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (result.success) return { data: result.data };
  return { error: result.error.issues[0]?.message ?? 'Input tidak valid' };
}
