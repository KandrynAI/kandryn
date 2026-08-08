export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type OwaspCategory =
  | 'A01:Broken Access Control'
  | 'A02:Cryptographic Failures'
  | 'A03:Injection'
  | 'A04:Insecure Design'
  | 'A05:Security Misconfiguration'
  | 'A06:Vulnerable Components'
  | 'A07:Authentication Failures'
  | 'A08:Data Integrity Failures'
  | 'A09:Logging Failures'
  | 'A10:SSRF'
  | 'Other';

export interface AegisFinding {
  id: string; // e.g. "aegis-001"
  severity: SecuritySeverity;
  owasp: OwaspCategory;
  title: string; // max 8 words
  detail: string; // 2-3 sentences, code-specific
  lineRef?: string; // e.g. "src/payments.ts:L42"
  remediation: string; // 1-2 sentences, actionable
  cveRef?: string; // e.g. "CVE-2024-XXXX" if applicable
  plmTicketUrl?: string; // populated after Jira/ADO ticket created
  plmTicketKey?: string; // e.g. "PAY-215"
  pushedToBoard?: boolean; // true after PLM ticket created + task synced
  remediationRunId?: number; // run ID if "Remediate Now" was triggered
  remediationStatus?: 'pending' | 'running' | 'committed' | 'failed';
}

export interface AegisRemediateRequest {
  findingId: string; // e.g. "aegis-002"
  action: 'push' | 'remediate-now';
}

export interface AegisScanResult {
  summary: string; // 2-3 sentence overall assessment
  findings: AegisFinding[];
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  gateDecision: 'approved' | 'blocked';
  gateReason: string; // one sentence explaining the decision
  scannedFile: string; // file path that was scanned
  generatedAt: string; // ISO timestamp
}
