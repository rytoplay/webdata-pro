import * as dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  env: process.env.NODE_ENV || 'development',
  session: {
    secret: process.env.SESSION_SECRET || 'webdata-pro-dev-secret-change-in-production',
    maxAge: 24 * 60 * 60 * 1000
  },
  sqlite: {
    path: process.env.SQLITE_PATH || './webdata-pro.sqlite'
  },
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'changeme'
  }
};
