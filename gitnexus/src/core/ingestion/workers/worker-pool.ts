import { Worker } from 'node:worker_threads';
import os from 'node:os';

export interface WorkerPool {
  /**
   * Dispatch items across workers. Items are split into chunks (one per worker),
   * each worker processes its chunk, and results are concatenated back in order.
   *
   * @param onProgress - Called with cumulative files processed across all workers
   */
  dispatch<TInput, TResult>(items: TInput[], onProgress?: (filesProcessed: number) => void): Promise<TResult[]>;

  /**
   * Terminate all workers. Must be called when done.
   */
  terminate(): Promise<void>;

  /** Number of workers in the pool */
  readonly size: number;
}

/**
 * Create a pool of worker threads.
 *
 * @param workerUrl - URL to the worker script (use `new URL('./parse-worker.js', import.meta.url)`)
 * @param poolSize - Number of workers (defaults to cpus - 1, minimum 1)
 */
export const createWorkerPool = (workerUrl: URL, poolSize?: number): WorkerPool => {
  const size = poolSize ?? Math.max(1, os.cpus().length - 1);
  const workers: Worker[] = [];

  for (let i = 0; i < size; i++) {
    workers.push(new Worker(workerUrl));
  }

  const dispatch = <TInput, TResult>(items: TInput[], onProgress?: (filesProcessed: number) => void): Promise<TResult[]> => {
    if (items.length === 0) return Promise.resolve([]);

    // Split items into one chunk per worker
    const chunkSize = Math.ceil(items.length / size);
    const chunks: TInput[][] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
      chunks.push(items.slice(i, i + chunkSize));
    }

    // Track per-worker progress for cumulative reporting
    const workerProgress = new Array(chunks.length).fill(0);

    // Send one chunk to each worker, collect results
    const promises = chunks.map((chunk, i) => {
      const worker = workers[i];
      return new Promise<TResult>((resolve, reject) => {
        const handler = (msg: any) => {
          if (msg && msg.type === 'progress') {
            // Intermediate progress from worker
            workerProgress[i] = msg.filesProcessed;
            if (onProgress) {
              const total = workerProgress.reduce((a, b) => a + b, 0);
              onProgress(total);
            }
          } else if (msg && msg.type === 'result') {
            // Final result
            worker.removeListener('message', handler);
            resolve(msg.data);
          } else {
            // Legacy: treat any non-typed message as result (backward compat)
            worker.removeListener('message', handler);
            resolve(msg);
          }
        };
        worker.on('message', handler);
        worker.once('error', (err) => {
          worker.removeListener('message', handler);
          reject(err);
        });
        worker.postMessage(chunk);
      });
    });

    return Promise.all(promises);
  };

  const terminate = async (): Promise<void> => {
    await Promise.all(workers.map(w => w.terminate()));
    workers.length = 0;
  };

  return { dispatch, terminate, size };
};
