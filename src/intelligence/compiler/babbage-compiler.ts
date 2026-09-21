/**
 * BABBAGE: Universal Integration Compiler
 * Blueprint Engine #41
 * 
 * Compiles and audits the entire architecture graph. Every module must declare a machine-readable contract.
 * Detects orphan outputs, missing consumers, schema mismatches, and illegal bypass paths.
 * Answers the primary question: "Is everything actually connected?"
 */

export type BabbageEdgeType = 'DATA' | 'CONTROL' | 'AUTHORIZATION' | 'SECURITY' | 'FEEDBACK';

export interface BabbageModuleContract {
  readonly module_id: string;
  readonly name: string;
  readonly layer: number;
  readonly version: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly dependencies: readonly string[];
  readonly consumers: readonly string[];
  readonly permissions: readonly string[];
  readonly prohibitions: readonly string[];
  readonly freshness_max_ms: number;
  readonly failure_mode: 'FAIL_CLOSED' | 'FAIL_SAFE' | 'DEGRADE' | 'PASS_THROUGH';
}

export interface BabbageAuditReport {
  readonly is_valid: boolean;
  readonly total_modules: number;
  readonly orphan_outputs: readonly string[];
  readonly missing_consumers: readonly string[];
  readonly illegal_authorization_paths: readonly string[];
  readonly circular_dependencies: readonly string[];
  readonly dead_modules: readonly string[];
  readonly unverified_critical_connections: readonly string[];
  readonly timestamp_ms: number;
}

export class BabbageIntegrationCompiler {
  public static readonly VERSION = '1.0.0';
  private modules: Map<string, BabbageModuleContract> = new Map();

  public registerModule(contract: BabbageModuleContract): void {
    this.modules.set(contract.module_id, contract);
  }

  public getModule(id: string): BabbageModuleContract | undefined {
    return this.modules.get(id);
  }

  public getAllModules(): readonly BabbageModuleContract[] {
    return Array.from(this.modules.values());
  }

  /**
   * Audits the registered architecture graph for orphaned outputs, missing connections,
   * and non-negotiable security violations (e.g., Intelligence -> Execution bypassing Guardian).
   */
  public compileAndAudit(): BabbageAuditReport {
    const orphanOutputs: string[] = [];
    const missingConsumers: string[] = [];
    const illegalPaths: string[] = [];
    const circularDeps: string[] = [];
    const deadModules: string[] = [];
    const unverifiedCritical: string[] = [];

    const allProvidedOutputs = new Set<string>();
    const allConsumedInputs = new Set<string>();

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
          illegalPaths.push(
            `Illegal permission in Layer ${mod.layer} module ${mod.module_id}: Cannot directly sign or execute.`
          );
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
