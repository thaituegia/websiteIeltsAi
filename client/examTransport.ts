// Every document receives a fresh identity; reloads cannot resume an exam lease.
export const examTabId = crypto.randomUUID();
export const examHeaders = () => ({ "X-Exam-Tab": examTabId });
