import type { INodePropertyOptions } from 'n8n-workflow';

// The passport events that register a version. A webhook delivers these;
// the event feed carries them beside the events of the passport's log.
export const VERSIONED_EVENTS: INodePropertyOptions[] = [
	{ name: 'Collected', value: 'collected' },
	{ name: 'Corrected', value: 'corrected' },
	{
		name: 'Lifecycle Transition',
		value: 'lifecycle_transition',
		description: 'A status change, such as a recall to suspended',
	},
	{ name: 'Published', value: 'published' },
	{ name: 'Recalled', value: 'recalled' },
	{ name: 'Recycled', value: 'recycled' },
	{ name: 'Refurbished', value: 'refurbished' },
	{ name: 'Reissued', value: 'reissued' },
	{ name: 'Repair', value: 'repair' },
	{ name: 'Rolled Back', value: 'rolled_back' },
	{ name: 'Superseded', value: 'superseded' },
	{ name: 'Voided', value: 'voided' },
];

export const LOG_EVENTS: INodePropertyOptions[] = [
	{ name: 'Incident', value: 'incident' },
	{ name: 'Inspection', value: 'inspection' },
	{ name: 'Ownership Transfer', value: 'ownership_transfer' },
	{ name: 'Recall Note', value: 'recall' },
	{ name: 'Registered With EU', value: 'registered_with_eu' },
	{ name: 'Validation Warning', value: 'validation_warning' },
];

export const ALL_EVENTS: INodePropertyOptions[] = [...VERSIONED_EVENTS, ...LOG_EVENTS].sort(
	(a, b) => a.name.localeCompare(b.name),
);
