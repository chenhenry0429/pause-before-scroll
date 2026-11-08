// Public endpoint only. No administrator or service secrets belong in this file.
const API_ORIGIN='https://pause-mobile-reminders.chenhenry860.workers.dev';
export function apiUrl(path){return API_ORIGIN+path;}
