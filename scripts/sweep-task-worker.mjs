import { workerData, parentPort } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { evaluateTrial } from './sweep-evaluator.mjs';
if (!workerData?.fixturePath || typeof workerData.fixturePath !== 'string') throw new Error('fixturePath must be a non-empty string');
const parsed = JSON.parse(readFileSync(workerData.fixturePath, 'utf8'));
const ticks = Array.isArray(parsed) ? parsed : parsed?.ticks;
parentPort.on('message', task => {
  try {
    if (task?.type !== 'RUN' || !Number.isInteger(task.taskId) || task.taskId < 0 || !Number.isInteger(task.seed) || task.seed < 0 || task.seed > 0xffffffff) throw new Error('Invalid task envelope');
    parentPort.postMessage({ type: 'RESULT', taskId: task.taskId, result: { ...task.params, ...evaluateTrial(ticks, task.params, task.options) } });
  } catch (error) {
    parentPort.postMessage({ type: 'ERROR', taskId: task?.taskId ?? -1, error: error?.stack || String(error) });
  }
});
