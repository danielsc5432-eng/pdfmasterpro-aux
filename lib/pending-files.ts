// In-memory transfer across client navigation; document bytes never enter storage.
let pending: File[] = [];
export function queueFiles(files: File[]) { pending = files; }
export function takeQueuedFiles() { const files = pending; pending = []; return files; }
