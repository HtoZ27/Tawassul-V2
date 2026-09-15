import { vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";

export function mockStateManager() {
  return {
    loadFromFile: vi.fn().mockResolvedValue({
      records: [],
      handoffs: [],
      recSeq: 0,
      hoffSeq: 0,
      agentErrors: {},
      agentRatings: {},
      dynamicAgents: [],
      agentModelMap: {},
    }),
    enforceStateLimits: vi.fn().mockReturnValue(() => {}),
    acquireStateLock: vi.fn().mockResolvedValue(true),
    releaseStateLock: vi.fn().mockResolvedValue(true),
    resetGlobalLock: vi.fn(),
    getKnownRevision: vi.fn().mockReturnValue(0),
    setKnownRevision: vi.fn(),
    getSessionDataCache: vi.fn().mockReturnValue({} as Record<string, unknown>),
    setSessionDataCache: vi.fn(),
    saveWithRevision: vi.fn().mockResolvedValue(undefined),
  };
}

export function mockConfigManager(config?: Record<string, unknown>) {
  return {
    config: { language: "en", rateLimits: {}, ...config },
  };
}

export function mockAgentManager() {
  return {
    ensureDefaultAgentMds: vi.fn(),
    dynamicAgents: [],
    getMaxHandoffs: () => 500,
    getMaxRecords: () => 500,
  };
}

export function mockErrorManager() {
  return {
    agentErrors: {},
    loadFrom: vi.fn(),
    decayErrors: vi.fn(),
    clearErrors: vi.fn(),
  };
}

export function mockRatingManager() {
  return {
    agentRatings: {},
  };
}

export function mockModelManager() {
  return {
    agentModelMap: {},
    loadTawaPrefsFile: vi.fn().mockResolvedValue(undefined),
    flushPrefsSave: vi.fn().mockResolvedValue(undefined),
  };
}

export function mockEventHub() {
  return { emit: vi.fn() };
}

export function mockDiscussionManager() {
  return {
    loadFromState: vi.fn(),
    getFullState: () => ({ discussions: [], evidencedDiscussions: [] }),
    getSequence: () => 0,
    getEvidenceManager: () => ({
      getSeqCounters: () => ({ seqReceipt: 0, seqClaim: 0, seqVerification: 0, seqChallenge: 0 }),
    }),
    flushSave: vi.fn(),
  };
}

export function mockTrainingEvaluator() {
  return {
    restoreFrom: vi.fn(),
    reset: vi.fn(),
    toJSON: () => ({}),
  };
}

export function mockSharedMemory() {
  return {
    get: () => ({ decisions: [], learnings: [], warnings: [], handoffHistory: [], agentContext: {}, fileContext: {} }),
    compact: vi.fn(),
  };
}

export function mockSessionManager() {
  return {
    start: vi.fn(),
    getSessionId: () => "test-session",
    cleanup: vi.fn(),
  };
}

export function mockPipelineManager() {
  return { reset: vi.fn() };
}

export function mockMemoryWatchdog() {
  return { start: vi.fn(), stop: vi.fn() };
}

export function mockFeatureIndex() {
  return {
    register: vi.fn(),
    transitionTo: vi.fn(),
    addFile: vi.fn(),
    addAlgorithm: vi.fn(),
    addTest: vi.fn(),
    addRegressionRecord: vi.fn(),
    setClosedBy: vi.fn(),
    setMetadata: vi.fn(),
    getEvaluationReports: vi.fn(),
    setEvaluationReport: vi.fn(),
    setEvaluationReports: vi.fn(),
    getById: vi.fn(),
    getByName: vi.fn(),
    getByFile: vi.fn(),
    getByAlgorithm: vi.fn(),
    getByComponent: vi.fn(),
    getByStatus: vi.fn(),
    getAll: vi.fn(),
    search: vi.fn(),
    snapshot: vi.fn(),
    toJSON: () => ({ entries: [] }),
    getStats: vi.fn(),
  };
}

export function mockFileLocks() {
  return {
    invalidateFSCache: vi.fn(),
    acquireLock: vi.fn().mockResolvedValue({ acquired: true }),
    releaseLock: vi.fn().mockResolvedValue(true),
    releaseAllForHandoff: vi.fn().mockResolvedValue([]),
    clearAll: vi.fn(),
    isLocked: vi.fn().mockResolvedValue(false),
    getLockedFiles: vi.fn().mockResolvedValue([]),
    getFilesLockedByAgent: vi.fn().mockResolvedValue([]),
    checkFileConflict: vi.fn().mockResolvedValue({ conflict: false }),
  };
}

export function mockMinimalContext(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    
    
    stateDir: join(tmpdir(), "test-state"),
    sessionManager: mockSessionManager(),
    stateManager: mockStateManager(),
    configManager: mockConfigManager(),
    agentManager: mockAgentManager(),
    errorManager: mockErrorManager(),
    ratingManager: mockRatingManager(),
    modelManager: mockModelManager(),
    records: [],
    handoffs: new Map(),
    recSeq: 0,
    hoffSeq: 0,
    seenAgents: new Map(),
    onboardedAgents: new Set(),
    pauseState: null,
    pipelineManager: mockPipelineManager(),
    memoryWatchdog: mockMemoryWatchdog(),
    sharedMemory: mockSharedMemory(),
    discussionManager: mockDiscussionManager(),
    trainingEvaluator: mockTrainingEvaluator(),
    eventHub: mockEventHub(),
    featureIndex: mockFeatureIndex(),
    fileLocks: mockFileLocks(),
    ...overrides,
  };
}
