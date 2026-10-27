import { sleep, type IDataObject, type IExecuteFunctions } from 'n8n-workflow';
import { patientRequest } from '../../shared/transport';

// The states in which background work of the workspace still runs: a
// bulk create, or an import validating, importing or restoring.
const RUNNING = ['pending', 'running', 'validating', 'importing', 'restoring'];

const FIRST_POLL = 1000;

const LONGEST_POLL = 30000;

// Reads the status of background work until it stops running, waiting
// a second at first and twice as long each time, up to half a minute,
// so a long run costs few of the client's hourly requests.
export async function finished(context: IExecuteFunctions, path: string): Promise<IDataObject> {
	let task = await patientRequest.call(context, 'GET', path);
	let wait = FIRST_POLL;
	while (RUNNING.includes(String(task.status))) {
		await sleep(wait, context.getExecutionCancelSignal());
		wait = Math.min(wait * 2, LONGEST_POLL);
		task = await patientRequest.call(context, 'GET', path);
	}

	return task;
}
