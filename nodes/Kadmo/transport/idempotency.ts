import type { IExecuteFunctions } from 'n8n-workflow';

export interface IdempotencyParts {
	executionId: string;
	nodeId: string;
	runIndex: number;
	itemIndex: number;
}

/**
 * The automatic `Idempotency-Key`: the execution, the node, the run and the item. n8n's Retry On Fail keeps all four,
 * so a retry after a timeout replays Kadmo's first answer instead of starting the same work twice; another item, a
 * loop's next run and a new execution each get a new key.
 */
export function buildIdempotencyKey(parts: IdempotencyParts): string {
	return `n8n-${parts.executionId}-${parts.nodeId}-${parts.runIndex}-${parts.itemIndex}`;
}

/** The key for one item: the Idempotency Key option when set, else {@link buildIdempotencyKey}. */
export function idempotencyKey(this: IExecuteFunctions, itemIndex: number, override: string): string {
	const own = override.trim();
	if (own) return own;
	return buildIdempotencyKey({
		executionId: String(this.getExecutionId() ?? 'manual'),
		nodeId: this.getNode().id,
		runIndex: this.getWorkflowDataProxy(itemIndex).$runIndex ?? 0,
		itemIndex,
	});
}
