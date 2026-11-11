// Available in every supported runtime (Node ≥ 17, all evergreen browsers). Declared here because
// @morphos/shared intentionally compiles without Node or DOM type libraries (CLAUDE.md constraint 5).
declare function structuredClone<T>(value: T): T
