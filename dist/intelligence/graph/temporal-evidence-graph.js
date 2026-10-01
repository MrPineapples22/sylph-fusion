/**
 * SOL-SYLPH Intelligence Fabric - Temporal Evidence Graph & Provenance Engine
 * Specifications: Parts VIII (Temporal Evidence Graph), IX (Graph Provenance),
 * XI (Behavioral Intelligence), XII (Motif & Cluster Detection), XIII (Graph Heat).
 */
export class TemporalEvidenceGraph {
    nodes = new Map();
    edges = new Map();
    outgoingEdges = new Map(); // source -> Set<edgeId>
    incomingEdges = new Map(); // target -> Set<edgeId>
    addNode(id, type, label) {
        const existing = this.nodes.get(id);
        if (existing) {
            existing.lastSeenMs = Date.now();
            existing.activityCount++;
            return existing;
        }
        const node = {
            id,
            type,
            label,
            firstSeenMs: Date.now(),
            lastSeenMs: Date.now(),
            activityCount: 1,
            heat: 0.5,
        };
        this.nodes.set(id, node);
        return node;
    }
    addOrUpdateEdge(params) {
        const edgeKey = `${params.sourceNode}->${params.relationship}->${params.targetNode}`;
        const now = Date.now();
        const contribution = {
            slot: params.slot,
            amountSol: params.amountSol ?? 0,
            timestampMs: now,
            supportingEventId: params.supportingEventId,
        };
        const existing = this.edges.get(edgeKey);
        if (existing) {
            existing.contributions.push(contribution);
            existing.lastSeenMs = now;
            existing.lastSlot = Math.max(existing.lastSlot, params.slot);
            existing.observationCount++;
            existing.transactionCount++;
            existing.amountTotalSol += params.amountSol ?? 0;
            if (params.supportingEventId && !existing.supportingEventIds.includes(params.supportingEventId)) {
                existing.supportingEventIds.push(params.supportingEventId);
            }
            if (params.commitment) {
                existing.commitment = params.commitment;
            }
            const srcNode = this.nodes.get(params.sourceNode);
            if (srcNode)
                srcNode.activityCount++;
            const tgtNode = this.nodes.get(params.targetNode);
            if (tgtNode)
                tgtNode.activityCount++;
            this.decayOrBoostHeat(params.sourceNode, 0.1);
            this.decayOrBoostHeat(params.targetNode, 0.1);
            return existing;
        }
        const srcNode = this.nodes.get(params.sourceNode);
        if (srcNode)
            srcNode.activityCount++;
        const tgtNode = this.nodes.get(params.targetNode);
        if (tgtNode)
            tgtNode.activityCount++;
        const edge = {
            edgeId: edgeKey,
            sourceNode: params.sourceNode,
            targetNode: params.targetNode,
            relationship: params.relationship,
            firstSeenMs: now,
            lastSeenMs: now,
            firstSlot: params.slot,
            lastSlot: params.slot,
            observationCount: 1,
            transactionCount: 1,
            amountTotalSol: params.amountSol ?? 0,
            confidence: params.confidence ?? (params.evidenceClass === 'FACT' ? 1.0 : 0.8),
            evidenceClass: params.evidenceClass,
            supportingEventIds: params.supportingEventId ? [params.supportingEventId] : [],
            inferenceRule: params.inferenceRule,
            commitment: params.commitment ?? 'confirmed',
            active: true,
            contributions: [contribution],
        };
        this.edges.set(edgeKey, edge);
        // Track adjacency
        if (!this.outgoingEdges.has(params.sourceNode)) {
            this.outgoingEdges.set(params.sourceNode, new Set());
        }
        this.outgoingEdges.get(params.sourceNode).add(edgeKey);
        if (!this.incomingEdges.has(params.targetNode)) {
            this.incomingEdges.set(params.targetNode, new Set());
        }
        this.incomingEdges.get(params.targetNode).add(edgeKey);
        this.decayOrBoostHeat(params.sourceNode, 0.15);
        this.decayOrBoostHeat(params.targetNode, 0.15);
        return edge;
    }
    rollbackSlotEdges(slot) {
        let rolledBackCount = 0;
        for (const [edgeKey, edge] of this.edges.entries()) {
            if (!edge.active)
                continue;
            const matchingContribs = edge.contributions.filter(c => c.slot === slot);
            if (matchingContribs.length === 0)
                continue;
            const removedAmount = matchingContribs.reduce((sum, c) => sum + c.amountSol, 0);
            const removedEventIds = new Set(matchingContribs.map(c => c.supportingEventId).filter(Boolean));
            edge.contributions = edge.contributions.filter(c => c.slot !== slot);
            edge.amountTotalSol = Math.max(0, edge.amountTotalSol - removedAmount);
            edge.observationCount = Math.max(0, edge.observationCount - matchingContribs.length);
            edge.transactionCount = Math.max(0, edge.transactionCount - matchingContribs.length);
            if (removedEventIds.size > 0) {
                for (let i = edge.supportingEventIds.length - 1; i >= 0; i--) {
                    if (removedEventIds.has(edge.supportingEventIds[i])) {
                        edge.supportingEventIds.splice(i, 1);
                    }
                }
            }
            // Decrement node activity
            const srcNode = this.nodes.get(edge.sourceNode);
            if (srcNode) {
                srcNode.activityCount = Math.max(0, srcNode.activityCount - matchingContribs.length);
                this.decayOrBoostHeat(edge.sourceNode, -0.1 * matchingContribs.length);
            }
            const tgtNode = this.nodes.get(edge.targetNode);
            if (tgtNode) {
                tgtNode.activityCount = Math.max(0, tgtNode.activityCount - matchingContribs.length);
                this.decayOrBoostHeat(edge.targetNode, -0.1 * matchingContribs.length);
            }
            if (edge.contributions.length === 0) {
                edge.active = false;
            }
            else {
                edge.lastSlot = Math.max(...edge.contributions.map(c => c.slot));
                edge.lastSeenMs = Math.max(...edge.contributions.map(c => c.timestampMs));
            }
            rolledBackCount++;
        }
        return rolledBackCount;
    }
    getNeighbors(nodeId) {
        const outKeys = this.outgoingEdges.get(nodeId) ?? new Set();
        const inKeys = this.incomingEdges.get(nodeId) ?? new Set();
        const neighbors = new Set();
        for (const k of outKeys) {
            const e = this.edges.get(k);
            if (e && e.active)
                neighbors.add(e.targetNode);
        }
        for (const k of inKeys) {
            const e = this.edges.get(k);
            if (e && e.active)
                neighbors.add(e.sourceNode);
        }
        return Array.from(neighbors);
    }
    getHeat(nodeId) {
        const node = this.nodes.get(nodeId);
        if (!node) {
            return { nodeId, heat: 0, isHot: false, recentActivityCount: 0, capitalFlowSol: 0 };
        }
        const outEdges = Array.from(this.outgoingEdges.get(nodeId) ?? [])
            .map((k) => this.edges.get(k))
            .filter((e) => !!e && e.active);
        const flow = outEdges.reduce((acc, e) => acc + e.amountTotalSol, 0);
        return {
            nodeId,
            heat: Number(node.heat.toFixed(3)),
            isHot: node.heat >= 0.7,
            recentActivityCount: node.activityCount,
            capitalFlowSol: Number(flow.toFixed(3)),
        };
    }
    getSummary() {
        let activeEdges = 0;
        for (const e of this.edges.values()) {
            if (e.active)
                activeEdges++;
        }
        let hotNodes = 0;
        for (const n of this.nodes.values()) {
            if (n.heat >= 0.7)
                hotNodes++;
        }
        return {
            nodeCount: this.nodes.size,
            edgeCount: this.edges.size,
            activeEdgeCount: activeEdges,
            hotNodesCount: hotNodes,
        };
    }
    decayOrBoostHeat(nodeId, delta) {
        const node = this.nodes.get(nodeId);
        if (node) {
            node.heat = Math.min(1.0, Math.max(0.0, node.heat + delta));
        }
    }
}
//# sourceMappingURL=temporal-evidence-graph.js.map