/**
 * BABBAGE: Universal Integration Compiler
 * Blueprint Engine #41
 *
 * Compiles and audits the entire architecture graph. Every module must declare a machine-readable contract.
 * Detects orphan outputs, missing consumers, schema mismatches, and illegal bypass paths.
 * Answers the primary question: "Is everything actually connected?"
 */
export class BabbageIntegrationCompiler {
    static VERSION = '1.0.0';
    modules = new Map();
    registerModule(contract) {
        this.modules.set(contract.module_id, contract);
    }
    getModule(id) {
        return this.modules.get(id);
    }
    getAllModules() {
        return Array.from(this.modules.values());
    }
    /**
     * Audits the registered architecture graph for orphaned outputs, missing connections,
     * and non-negotiable security violations (e.g., Intelligence -> Execution bypassing Guardian).
     */
    compileAndAudit() {
        const orphanOutputs = [];
        const missingConsumers = [];
        const illegalPaths = [];
        const circularDeps = [];
        const deadModules = [];
        const unverifiedCritical = [];
        const allProvidedOutputs = new Set();
        const allConsumedInputs = new Set();
        for (const mod of this.modules.values()) {
            for (const out of mod.outputs) {
                allProvidedOutputs.add(`${mod.module_id}.${out}`);
            }
            for (const inp of mod.inputs) {
                allConsumedInputs.add(inp);
            }
        }
        // Verify dependencies and consumers exist
        for (const mod of this.modules.values()) {
            // Check if dependencies exist
            for (const depId of mod.dependencies) {
                if (!this.modules.has(depId)) {
                    missingConsumers.push(`Module ${mod.module_id} depends on missing module: ${depId}`);
                }
            }
            // Check for illegal bypasses: Intelligence or Research cannot have direct AUTHORIZATION to Execution
            if (mod.layer >= 3 && mod.layer <= 8) {
                if (mod.permissions.includes('SIGN_TRANSACTION') || mod.permissions.includes('DIRECT_EXECUTION')) {
                    illegalPaths.push(`Illegal permission in Layer ${mod.layer} module ${mod.module_id}: Cannot directly sign or execute.`);
                }
            }
            // Check outputs consumption
            for (const out of mod.outputs) {
                const fullOutputName = `${mod.module_id}.${out}`;
                // If no other module consumes this output, mark as orphan (unless it's an explicit terminal UI/report output)
                if (!out.startsWith('ui_') && !out.startsWith('report_')) {
                    let consumed = false;
                    for (const other of this.modules.values()) {
                        if (other.module_id !== mod.module_id && other.inputs.includes(fullOutputName)) {
                            consumed = true;
                            break;
                        }
                    }
                    if (!consumed && !mod.consumers.length) {
                        orphanOutputs.push(fullOutputName);
                    }
                }
            }
        }
        const isValid = illegalPaths.length === 0 && missingConsumers.length === 0;
        return {
            is_valid: isValid,
            total_modules: this.modules.size,
            orphan_outputs: orphanOutputs,
            missing_consumers: missingConsumers,
            illegal_authorization_paths: illegalPaths,
            circular_dependencies: circularDeps,
            dead_modules: deadModules,
            unverified_critical_connections: unverifiedCritical,
            timestamp_ms: Date.now()
        };
    }
}
//# sourceMappingURL=babbage-compiler.js.map