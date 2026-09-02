/// <reference types="vite/client" />

interface Env {
  DOWNLOADS: R2Bucket;
  BOOKS: R2Bucket;
  DB: D1Database;
  RESEND_API_KEY?: string;
  JWT_SECRET?: string;
}
