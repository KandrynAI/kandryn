import { GitService, type GitCreds } from "./gitService.js";
import { getConfigs } from "./configService.js";
import { logger } from "../lib/logger.js";
import type { NarratiaResult, RunbookTarget, RunbookSection } from "../../../../shared/types/narratiaResult.js";
import { PR_TITLE_PREFIX } from "../../../../shared/types/branding.js";

export interface PushResult {
  url: string;
  target: RunbookTarget;
}

// ---------------------------------------------------------------------------
// Target A: Markdown — commit the runbook onto the existing PR branch (stacks
// on the branch HEAD, same pattern as the test-script commit). Never throws.
// ---------------------------------------------------------------------------
export async function pushAsMarkdown(params: {
  markdown: string;
  filePath: string;
  branchName: string;
  repoId: number;
  repoUrl: string;
  creds: GitCreds;
}): Promise<PushResult | null> {
  try {
    const git = await GitService.forRepo(params.repoId, params.creds);
    const headSha = await git.branchHeadSha(params.branchName);
    await git.commitChanges({
      branchName: params.branchName,
      baseSha: headSha,
      message: `${PR_TITLE_PREFIX} Add runbook (${params.filePath})`,
      files: [{ path: params.filePath, content: params.markdown }],
    });
    return {
      url: `${params.repoUrl.replace(/\.git$/, "")}/blob/${params.branchName}/${params.filePath}`,
      target: "markdown",
    };
  } catch (err) {
    logger.warn({ err }, "Narratia markdown commit failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Target B: Confluence — create a page in the configured space. Returns null
// when the user hasn't configured Confluence or the API call fails.
// ---------------------------------------------------------------------------
function markdownToConfluenceHtml(markdown: string): string {
  return markdown
    .replace(/```(\w+)?\n([\s\S]*?)```/g,
      '<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[$2]]></ac:plain-text-body></ac:structured-macro>')
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/^(\d+)\. (.+)$/gm, "<li>$2</li>");
}

export async function pushToConfluence(userId: string, result: NarratiaResult): Promise<PushResult | null> {
  const c = await getConfigs(userId, [
    "CONFLUENCE_DOMAIN",
    "CONFLUENCE_EMAIL",
    "CONFLUENCE_API_TOKEN",
    "CONFLUENCE_SPACE_KEY",
  ]);
  if (!c.CONFLUENCE_DOMAIN || !c.CONFLUENCE_EMAIL || !c.CONFLUENCE_API_TOKEN || !c.CONFLUENCE_SPACE_KEY) {
    return null;
  }

  const body = {
    type: "page",
    title: result.title,
    space: { key: c.CONFLUENCE_SPACE_KEY },
    body: { storage: { value: markdownToConfluenceHtml(result.markdown), representation: "storage" } },
  };

  try {
    const res = await fetch(`https://${c.CONFLUENCE_DOMAIN}/wiki/rest/api/content`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${c.CONFLUENCE_EMAIL}:${c.CONFLUENCE_API_TOKEN}`).toString("base64"),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Confluence runbook push failed");
      return null;
    }
    const data = (await res.json()) as { _links?: { webui?: string }; id?: string };
    const url = data._links?.webui
      ? `https://${c.CONFLUENCE_DOMAIN}/wiki${data._links.webui}`
      : `https://${c.CONFLUENCE_DOMAIN}/wiki/pages/${data.id}`;
    return { url, target: "confluence" };
  } catch (err) {
    logger.warn({ err }, "Confluence runbook push errored");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Target C: Notion — create a child page from the parsed sections. Returns null
// when Notion isn't configured or the API call fails.
// ---------------------------------------------------------------------------
function notionBlocksFromSections(sections: RunbookSection[]): object[] {
  const blocks: object[] = [];
  for (const section of sections) {
    blocks.push({
      type: "heading_2",
      heading_2: { rich_text: [{ type: "text", text: { content: section.title } }] },
    });
    for (const line of section.content.split("\n")) {
      if (!line.trim()) continue;
      blocks.push({
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: line.slice(0, 2000) } }] },
      });
    }
  }
  return blocks.slice(0, 100); // Notion caps children per request at 100
}

export async function pushToNotion(userId: string, result: NarratiaResult): Promise<PushResult | null> {
  const c = await getConfigs(userId, ["NOTION_API_TOKEN", "NOTION_PARENT_PAGE"]);
  if (!c.NOTION_API_TOKEN || !c.NOTION_PARENT_PAGE) return null;

  const body = {
    parent: { page_id: c.NOTION_PARENT_PAGE },
    properties: { title: { title: [{ type: "text", text: { content: result.title } }] } },
    children: notionBlocksFromSections(result.sections),
  };

  try {
    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.NOTION_API_TOKEN}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Notion runbook push failed");
      return null;
    }
    const data = (await res.json()) as { url?: string };
    return { url: data.url ?? "", target: "notion" };
  } catch (err) {
    logger.warn({ err }, "Notion runbook push errored");
    return null;
  }
}
