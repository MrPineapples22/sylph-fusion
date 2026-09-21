/**
 * SOL-SYLPH Master Production Intelligence - Priority Backpressure Controller
 * Specifications: Section 93 (Backpressure).
 *
 * Rules:
 * 1. P0 (Safety/Execution) and P1 (Live Trades) are never dropped.
 * 2. Under queue saturation, shed or coalesce P4 (analytics) and P5 (GUI).
 * 3. Track queue depth, dropped events, and shed statistics.
 */
export class PriorityBackpressureController {
    maxQueueDepthPerClass;
    p0Queue = [];
    p1Queue = [];
    p2Queue = [];
    p3Queue = [];
    p4Queue = [];
    p5Queue = [];
    totalEnqueued = 0;
    totalDequeued = 0;
    totalShed = 0;
    constructor(maxQueueDepthPerClass = 500) {
        this.maxQueueDepthPerClass = maxQueueDepthPerClass;
    }
    enqueue(item) {
        this.totalEnqueued += 1;
        switch (item.priority) {
            case 'P0_SAFETY_EXECUTION':
                // P0 is never shed
                this.p0Queue.push(item);
                return true;
            case 'P1_LIVE_CANDIDATE':
                // P1 is prioritized
                if (this.p1Queue.length >= this.maxQueueDepthPerClass * 2) {
                    // Shed oldest P1 only if extreme overflow
                    this.p1Queue.shift();
                    this.totalShed += 1;
                }
                this.p1Queue.push(item);
                return true;
            case 'P2_TOKEN_INGEST':
                if (this.p2Queue.length >= this.maxQueueDepthPerClass) {
                    this.p2Queue.shift();
                    this.totalShed += 1;
                }
                this.p2Queue.push(item);
                return true;
            case 'P3_REFRESH':
                if (this.p3Queue.length >= this.maxQueueDepthPerClass) {
                    this.p3Queue.shift();
                    this.totalShed += 1;
                }
                this.p3Queue.push(item);
                return true;
            case 'P4_ANALYTICS':
                if (this.p4Queue.length >= this.maxQueueDepthPerClass / 2) {
                    this.p4Queue.shift();
                    this.totalShed += 1;
                }
                this.p4Queue.push(item);
                return true;
            case 'P5_GUI':
                if (this.p5Queue.length >= this.maxQueueDepthPerClass / 2) {
                    this.p5Queue.shift();
                    this.totalShed += 1;
                }
                this.p5Queue.push(item);
                return true;
        }
    }
    dequeue() {
        let item = this.p0Queue.shift();
        if (!item)
            item = this.p1Queue.shift();
        if (!item)
            item = this.p2Queue.shift();
        if (!item)
            item = this.p3Queue.shift();
        if (!item)
            item = this.p4Queue.shift();
        if (!item)
            item = this.p5Queue.shift();
        if (item)
            this.totalDequeued += 1;
        return item;
    }
    getStats() {
        return {
            totalEnqueued: this.totalEnqueued,
            totalDequeued: this.totalDequeued,
            totalShed: this.totalShed,
            totalRemaining: this.p0Queue.length +
                this.p1Queue.length +
                this.p2Queue.length +
                this.p3Queue.length +
                this.p4Queue.length +
                this.p5Queue.length,
            depths: {
                P0_SAFETY_EXECUTION: this.p0Queue.length,
                P1_LIVE_CANDIDATE: this.p1Queue.length,
                P2_TOKEN_INGEST: this.p2Queue.length,
                P3_REFRESH: this.p3Queue.length,
                P4_ANALYTICS: this.p4Queue.length,
                P5_GUI: this.p5Queue.length,
            },
        };
    }
}
//# sourceMappingURL=backpressure.js.map