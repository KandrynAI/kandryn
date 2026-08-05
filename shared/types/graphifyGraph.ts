// Matches the graph.json output from graphify build
export interface GraphifyNode {
  id:             string      // e.g. "src/payments.ts::processPayment"
  label:          string      // e.g. "processPayment"
  fileType:       string      // "code" | "doc" | "config"
  sourceFile:     string      // e.g. "src/payments.ts"
  sourceLocation: string      // e.g. "src/payments.ts:14"
  community?:     number
  degree?:        number
}

export interface GraphifyEdge {
  source:     string   // node id
  target:     string   // node id
  relation:   string   // "contains" | "calls" | "imports" | "imports_from" | "inherits"
  confidence: string   // "EXTRACTED" | "INFERRED"
}

export interface GraphifyGraph {
  nodes:    GraphifyNode[]
  edges:    GraphifyEdge[]
  metadata: {
    files:       number
    nodes:       number
    edges:       number
    builtAt?:    string
    repoUrl?:    string
  }
}
