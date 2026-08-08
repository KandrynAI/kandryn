export type RunbookTarget = 'markdown' | 'confluence' | 'notion';

export interface RunbookSection {
  title: string;
  content: string;
}

export interface NarratiaResult {
  title: string; // runbook title
  target: RunbookTarget;
  markdown: string; // the full runbook in Markdown
  sections: RunbookSection[]; // parsed sections for structured display
  pushedUrl?: string; // URL if pushed to Confluence/Notion/markdown
  generatedAt: string;
}
