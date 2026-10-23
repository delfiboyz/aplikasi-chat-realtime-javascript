const env = process.env;

const isProduction = env.NODE_ENV === 'production';

if (isProduction && !env.JWT_SECRET) {
  throw new Error('JWT_SECRET wajib diisi saat NODE_ENV=production');
}

export const config = Object.freeze({
  port: Number(env.PORT) || 3000,
  mongoUri: env.MONGODB_URI || '',
  jwtSecret: env.JWT_SECRET || 'dev-only-insecure-secret',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '7d',
  isProduction,
  cookieName: 'chat_token',
});
