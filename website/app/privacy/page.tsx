import type { Metadata } from 'next';
import { LegalPage, LegalHeader, Toc, Section, H3, P, Bullets, ContactBlock, Mail } from '@/components/legal/legal-ui';

export const metadata: Metadata = {
  title: 'Privacy Policy | Blue Mantis',
  description: 'How Blue Mantis collects, uses, and protects your information.',
  alternates: { canonical: '/privacy/' },
};

const TOC = [
  { id: 'who-we-are', label: 'Who we are' },
  { id: 'information-we-collect', label: 'Information we collect' },
  { id: 'how-we-use', label: 'How we use your information' },
  { id: 'what-we-share', label: 'What we share and with whom' },
  { id: 'data-retention', label: 'How long we keep your data' },
  { id: 'your-rights', label: 'Your rights and choices' },
  { id: 'data-security', label: 'Data security' },
  { id: 'childrens-privacy', label: "Children's privacy" },
  { id: 'changes', label: 'Changes to this policy' },
  { id: 'contact', label: 'Contact us' },
];

export default function PrivacyPage() {
  return (
    <LegalPage>
      <LegalHeader
        title="Privacy Policy"
        sub="How Blue Mantis collects, uses, shares, and protects your information."
        meta={
          <>
            Effective: 1 August 2026 · Last updated: 10 August 2026
            <br />
            Venakan Info Solutions LLC · getbluemantis.com
          </>
        }
      />

      <Toc items={TOC} />

      <Section id="who-we-are" n={1} title="Who we are">
        <P>
          Blue Mantis is a product of Venakan Info Solutions LLC, incorporated in Ohio, United States. We provide an
          AI-powered software delivery platform at getbluemantis.com that connects project management tools with version
          control systems to assist engineering teams in generating, reviewing, and committing code. This policy applies
          to the platform and all related services.
        </P>
      </Section>

      <Section id="information-we-collect" n={2} title="Information we collect">
        <H3>Information you provide directly</H3>
        <Bullets
          items={[
            'Email address and name (via sign-up or OAuth)',
            'Authentication credentials managed by Clerk (our auth provider)',
            'API tokens for connected services: Jira, Azure DevOps, GitHub, Azure Repos, Confluence, Notion, Anthropic, OpenAI. Stored securely, never included in AI prompts or logs.',
            'Work item content: titles, descriptions, acceptance criteria',
            'Any information provided when contacting us',
          ]}
        />

        <H3>Information generated automatically</H3>
        <Bullets
          items={[
            'Run metadata: timestamps, status, scores, PR URLs, commit hashes',
            'Audit log data: action names, timestamps, IP addresses, user agents',
            'Session data managed by Clerk',
            'Usage patterns for product improvement',
          ]}
        />

        <H3>Information from connected integrations</H3>
        <Bullets
          items={[
            'Work items from Jira or Azure DevOps',
            'Selected source code file sections (3-8 files) read at run time from GitHub or Azure Repos. Sent to AI model providers. NOT stored by Blue Mantis after the run completes.',
            'Repository metadata: file paths, branch names, commit hashes',
          ]}
        />

        <P>
          We do NOT read your full repository, production databases, environment variables, GitHub Actions secrets, or
          any data outside the scope of the connected work item.
        </P>
      </Section>

      <Section id="how-we-use" n={3} title="How we use your information">
        <H3>To provide the Service</H3>
        <Bullets
          items={[
            'Execute AI agent runs using your connected credentials',
            'Generate code suggestions, security reports, test cases, runbooks',
            'Open pull requests and update work item status',
            'Send run result notifications via email (Resend)',
          ]}
        />

        <H3>For security</H3>
        <Bullets
          items={[
            'Maintain audit logs for security and compliance',
            'Detect and prevent unauthorised access and misuse',
            'Enforce our Terms of Service',
          ]}
        />

        <H3>To improve the Service</H3>
        <Bullets
          items={['Analyse usage patterns and performance', 'Diagnose technical problems', 'Develop new features']}
        />

        <H3>To communicate with you</H3>
        <Bullets
          items={['Respond to support requests', 'Send operational emails', 'Send product updates (if opted in)']}
        />

        <P>To comply with legal obligations.</P>

        <P>
          We do NOT use your source code, work item content, or AI-generated outputs to train any AI model. All AI
          inference uses Anthropic and OpenAI enterprise APIs, which prohibit training on API customer data.
        </P>
      </Section>

      <Section id="what-we-share" n={4} title="What we share and with whom">
        <P>We do not sell your personal information.</P>

        <H3>Sub-processors</H3>
        <P>
          Complete list at{' '}
          <a href="/trust/#sub-processors" style={{ color: '#1a4fd6', fontWeight: 600, textDecoration: 'none' }}>
            getbluemantis.com/trust/#sub-processors
          </a>
          :
        </P>
        <Bullets
          items={[
            'Supabase: database (run metadata, audit logs) — US East region',
            'Clerk: authentication and sessions — US region',
            'Anthropic: AI inference (work item + selected code) — US region',
            'OpenAI: AI inference (same content as Anthropic) — US region',
            'Vercel: application hosting — US region',
            'Resend: transactional email — US region',
          ]}
        />
        <P>Your API credentials are NEVER shared with AI providers or email services.</P>

        <H3>Business transfers</H3>
        <P>
          Information may transfer in an acquisition or merger. We will notify you before your data is transferred.
        </P>

        <H3>Legal requirements</H3>
        <P>We may disclose information when required by law or to protect rights and safety.</P>
      </Section>

      <Section id="data-retention" n={5} title="How long we keep your data">
        <Bullets
          items={[
            <><strong>Account data:</strong> Until account deletion plus 30 days.</>,
            <><strong>Run metadata:</strong> Indefinitely while account is active; deletable on request.</>,
            <><strong>Source code sent to AI:</strong> Not stored by Blue Mantis after run completion.</>,
            <><strong>Audit log:</strong> 30 days (Free), 90 days (Pro/Max), 365 days (Enterprise).</>,
            <><strong>Credentials:</strong> Until deleted from Settings or account deletion.</>,
            <><strong>Database backups:</strong> Up to 30 days.</>,
          ]}
        />
      </Section>

      <Section id="your-rights" n={6} title="Your rights and choices">
        <Bullets
          items={[
            <><strong>Access:</strong> Request a copy of your data — <Mail addr="privacy@getbluemantis.com" /></>,
            <><strong>Correction:</strong> Update account info in Settings at any time.</>,
            <>
              <strong>Deletion:</strong> Request account deletion — <Mail addr="privacy@getbluemantis.com" />. Processed
              within 30 days. Some data retained for legal compliance.
            </>,
            <><strong>Data portability:</strong> Request an export — <Mail addr="privacy@getbluemantis.com" /></>,
            <><strong>Objection/restriction:</strong> Contact us to object to certain processing.</>,
          ]}
        />

        <H3>California residents (CCPA)</H3>
        <P>
          Right to know what we collect. Right to delete. Right to opt out of sale (we do not sell data). Right to
          non-discrimination.
        </P>
        <P>
          Contact: <Mail addr="privacy@getbluemantis.com" />
        </P>
        <P>We verify identity before processing requests and respond within 30 days.</P>
      </Section>

      <Section id="data-security" n={7} title="Data security">
        <H3>Our security measures</H3>
        <Bullets
          items={[
            'All data in transit: TLS 1.2 or higher',
            'All data at rest: AES-256 encryption (AWS RDS)',
            'API credentials stored per-user, never written to logs',
            'Production access restricted to named individuals with MFA',
            'Audit log records all significant platform actions',
            'Aegis security agent scans AI-generated code before PRs open',
          ]}
        />
        <P>
          No transmission method is 100% secure. If you discover a vulnerability, report it to{' '}
          <Mail addr="security@getbluemantis.com" /> — we respond within 1 business day.
        </P>
      </Section>

      <Section id="childrens-privacy" n={8} title="Children's privacy">
        <P>
          Blue Mantis is not directed to children under 16. We do not knowingly collect information from children under
          16. Contact <Mail addr="privacy@getbluemantis.com" /> to report any inadvertent collection.
        </P>
      </Section>

      <Section id="changes" n={9} title="Changes to this policy">
        <P>We update this policy as needed. For material changes:</P>
        <Bullets
          items={[
            'We update the Last updated date',
            'We notify registered users by email at least 30 days before changes',
            'Continued use after the effective date constitutes acceptance',
          ]}
        />
      </Section>

      <Section id="contact" n={10} title="Contact us">
        <ContactBlock>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: '#2c3e50', margin: 0 }}>
            <Mail addr="privacy@getbluemantis.com" />
            <br />
            <br />
            Venakan Info Solutions LLC
            <br />
            Ohio, United States
            <br />
            getbluemantis.com
            <br />
            <br />
            <em>We respond to all privacy inquiries within 5 business days.</em>
          </p>
        </ContactBlock>
      </Section>
    </LegalPage>
  );
}
