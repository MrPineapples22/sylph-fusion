/**
 * SOL-SYLPH Production Architecture - Command Gateway & Control Audit Engine
 * Specifications: Sections 13 (Command Gateway) & 14 (Interactive-Control Audit Contract)
 */
export class CommandGateway {
    auditRegistry = new Map();
    executionHistory = [];
    constructor() {
        this.registerDefaultControlContracts();
    }
    registerControl(record) {
        this.auditRegistry.set(record.controlId, record);
    }
    getControlAudit(controlId) {
        return this.auditRegistry.get(controlId);
    }
    validateCommand(payload, currentContext) {
        const isReducing = payload.actionType === 'CLOSE' || payload.actionType === 'REDUCE' || payload.actionType === 'PANIC_CLOSE_ALL';
        const isIncreasing = payload.actionType === 'OPEN' || payload.actionType === 'INCREASE';
        if (isReducing) {
            if (payload.actionType !== 'PANIC_CLOSE_ALL' && !currentContext.hasPosition) {
                return {
                    isValid: false,
                    reasonCode: 'NO_ACTIVE_POSITION',
                    message: 'Cannot close or reduce non-existent position.',
                    classification: 'EXPOSURE_REDUCING',
                };
            }
            // Critical Invariant: Exposure-reducing actions are NEVER blocked by max positions or entry feed staleness
            return {
                isValid: true,
                classification: 'EXPOSURE_REDUCING',
            };
        }
        if (isIncreasing) {
            if (currentContext.activePositionsCount >= currentContext.maxPositions) {
                return {
                    isValid: false,
                    reasonCode: 'MAX_POSITIONS_REACHED',
                    message: `Active positions (${currentContext.activePositionsCount}) at capacity (${currentContext.maxPositions}).`,
                    classification: 'EXPOSURE_INCREASING',
                };
            }
            if (!currentContext.feedFresh) {
                return {
                    isValid: false,
                    reasonCode: 'FEED_STALE',
                    message: 'Market data feed is stale (>5s lag). New entry blocked.',
                    classification: 'EXPOSURE_INCREASING',
                };
            }
            if (!currentContext.rpcHealthy) {
                return {
                    isValid: false,
                    reasonCode: 'RPC_UNHEALTHY',
                    message: 'Cluster RPC health degraded. New entry blocked.',
                    classification: 'EXPOSURE_INCREASING',
                };
            }
            return {
                isValid: true,
                classification: 'EXPOSURE_INCREASING',
            };
        }
        // Administrative commands
        return {
            isValid: true,
            classification: 'ADMINISTRATIVE',
        };
    }
    async executeCommand(payload, context, executor) {
        const start = Date.now();
        const validation = this.validateCommand(payload, context);
        const auditRecord = this.auditRegistry.get(payload.controlId) || {
            controlId: payload.controlId,
            screen: payload.screen,
            purpose: `Execute ${payload.actionType}`,
            command: payload.actionType,
            handler: 'DefaultCommandHandler',
            prerequisiteState: 'ContextValidated',
            expectedTransition: 'StateUpdated',
            backendOwner: 'ControlKernel',
            timeoutMs: 5000,
            failureResult: 'REJECTED',
            verifiedStatus: 'VERIFIED',
        };
        if (!validation.isValid) {
            const report = {
                commandId: payload.commandId,
                controlId: payload.controlId,
                actionType: payload.actionType,
                status: 'REJECTED',
                reason: validation.message,
                executionTimeMs: Date.now() - start,
                timestamp: Date.now(),
                auditRecord,
            };
            this.executionHistory.push(report);
            return report;
        }
        try {
            const result = await executor(payload);
            const report = {
                commandId: payload.commandId,
                controlId: payload.controlId,
                actionType: payload.actionType,
                status: result.success ? 'EXECUTED' : 'REJECTED',
                reason: result.error,
                executionTimeMs: Date.now() - start,
                timestamp: Date.now(),
                auditRecord,
            };
            this.executionHistory.push(report);
            return report;
        }
        catch (err) {
            const report = {
                commandId: payload.commandId,
                controlId: payload.controlId,
                actionType: payload.actionType,
                status: 'REJECTED',
                reason: err.message || 'Execution error',
                executionTimeMs: Date.now() - start,
                timestamp: Date.now(),
                auditRecord,
            };
            this.executionHistory.push(report);
            return report;
        }
    }
    registerDefaultControlContracts() {
        this.registerControl({
            controlId: 'BTN_CLOSE_100',
            screen: 'PositionsTable',
            purpose: 'Liquidate 100% of open paper position immediately at current mark or fallback',
            command: 'CLOSE',
            handler: 'order(asset, "sell")',
            prerequisiteState: 'PositionExists',
            expectedTransition: 'PositionEvictedFromLedger',
            backendOwner: 'ExecutionEngine',
            timeoutMs: 3000,
            failureResult: 'PositionRemainsOpenWithAlert',
            verifiedStatus: 'VERIFIED',
        });
        this.registerControl({
            controlId: 'BTN_PANIC_CLOSE_ALL',
            screen: 'HeaderControls',
            purpose: 'Emergency liquidation of all active positions',
            command: 'PANIC_CLOSE_ALL',
            handler: 'handlePanicAll()',
            prerequisiteState: 'AnyActivePosition',
            expectedTransition: 'AllPositionsEvictedAndPendingBuysCancelled',
            backendOwner: 'ControlKernel',
            timeoutMs: 5000,
            failureResult: 'PositionsRetainedWithNotice',
            verifiedStatus: 'VERIFIED',
        });
        this.registerControl({
            controlId: 'BTN_MANUAL_BUY',
            screen: 'OrderEntryPanel',
            purpose: 'Manual one-click order entry for selected asset',
            command: 'OPEN',
            handler: 'handleManualBuy()',
            prerequisiteState: 'FeedFreshAndUnderMaxPositions',
            expectedTransition: 'NewPositionOpenedOrReserved',
            backendOwner: 'ControlKernel',
            timeoutMs: 3000,
            failureResult: 'EntryRejectedNoFundsDeducted',
            verifiedStatus: 'VERIFIED',
        });
        this.registerControl({
            controlId: 'BTN_ACK_INCIDENT',
            screen: 'AlertCenter',
            purpose: 'Acknowledge system alert and clear banner',
            command: 'ACKNOWLEDGE_INCIDENT',
            handler: 'acknowledgeAlert(id)',
            prerequisiteState: 'AlertExists',
            expectedTransition: 'AlertMarkedAcknowledged',
            backendOwner: 'AlertManager',
            timeoutMs: 1000,
            failureResult: 'AlertRemainsActive',
            verifiedStatus: 'VERIFIED',
        });
    }
}
//# sourceMappingURL=command-gateway.js.map