import type { Metadata } from 'next';
import { LegalPage, LegalHeader, Toc, Section, P, Bullets, DisclaimerBox, ContactBlock, Mail } from '@/components/legal/legal-ui';

export const metadata: Metadata = {
  title: 'Terms of Service | Blue Mantis',
  description: 'Terms governing your use of the Blue Mantis platform.',
  alternates: { canonical: '/terms/' },
};

const TOC = [
  { id: 'acceptance', label: 'Acceptance of terms' },
  { id: 'description', label: 'Description of service' },
  { id: 'accounts', label: 'Account registration' },
  { id: 'acceptable-use', label: 'Acceptable use' },
  { id: 'your-content', label: 'Your content and data' },
  { id: 'intellectual-property', label: 'Intellectual property' },
  { id: 'ai-outputs', label: 'AI-generated code and outputs' },
  { id: 'integrations', label: 'Third-party integrations' },
  { id: 'payment', label: 'Payment and subscription' },
  { id: 'availability', label: 'Service availability' },
  { id: 'disclaimer', label: 'Disclaimer of warranties' },
  { id: 'liability', label: 'Limitation of liability' },
  { id: 'indemnification', label: 'Indemnification' },
  { id: 'termination', label: 'Termination' },
  { id: 'governing-law', label: 'Governing law' },
  { id: 'changes', label: 'Changes to terms' },
  { id: 'contact', label: 'Contact' },
];

export default function TermsPage() {
  return (
    <LegalPage>
      <LegalHeader
        title="Terms of Service"
        sub="The agreement between you and Blue Mantis governing use of the platform."
        meta={
          <>
            Effective: 1 August 2026 · Last updated: 10 August 2026
            <br />
            Venakan Info Solutions LLC
          </>
        }
      />

      <Toc items={TOC} />

      <Section id="acceptance" n={1} title="Acceptance of terms">
        <P>
          By using Blue Mantis you agree to these Terms. If using on behalf of an organisation, you represent you have
          authority to bind it. If you disagree, do not use the Service.
        </P>
      </Section>

      <Section id="description" n={2} title="Description of service">
        <P>Blue Mantis is an AI-powered software delivery platform that:</P>
        <Bullets
          items={[
            'Connects to Jira, Azure DevOps, GitHub, Azure Repos',
            'Reads work items and selected source code files',
            'Runs AI agents to generate, rank, review, and secure code',
            'Opens pull requests on your behalf',
            'Generates test cases, security reports, and runbooks',
          ]}
        />
        <P>We may modify, suspend, or discontinue the Service with reasonable notice.</P>
      </Section>

      <Section id="accounts" n={3} title="Account registration">
        <P>
          You must: provide accurate information, maintain credential security, notify us of unauthorised use, and be at
          least 18 years old. We may refuse service or terminate accounts at our discretion.
        </P>
      </Section>

      <Section id="acceptable-use" n={4} title="Acceptable use">
        <P>You agree not to:</P>
        <Bullets
          items={[
            'Violate any law or regulation',
            'Infringe intellectual property rights',
            'Upload malware or harmful code',
            'Gain unauthorised access to any system',
            'Interfere with the Service',
            'Generate code intended to cause harm',
            'Reverse engineer the Service',
            'Resell access without written permission',
            'Use automated means beyond reasonable usage',
          ]}
        />
        <P>Violations may result in account termination and law enforcement reporting.</P>
      </Section>

      <Section id="your-content" n={5} title="Your content and data">
        <P>
          <strong>Ownership:</strong> You retain all rights to your content and source code.
        </P>
        <P>
          <strong>Licence:</strong> You grant Blue Mantis a limited licence to process your content solely to provide
          the Service. This licence ends when you stop using the Service.
        </P>
        <P>
          <strong>Responsibility:</strong> You are solely responsible for your content and ensuring you have the right to
          provide it.
        </P>
      </Section>

      <Section id="intellectual-property" n={6} title="Intellectual property">
        <P>
          Blue Mantis owns all IP in the Service including the platform, agent pipeline, and scoring algorithms. These
          Terms grant no rights to use our trademarks or brand features without written consent.
        </P>
      </Section>

      <Section id="ai-outputs" n={7} title="AI-generated code and outputs">
        <P>
          <strong>Ownership:</strong> You own the code suggestions, test cases, runbooks, and other outputs generated on
          your behalf.
        </P>
        <P>
          <strong>No warranty on outputs:</strong> AI-generated outputs are provided as-is. We do not warrant that
          outputs are correct, complete, or free of bugs or security vulnerabilities. You are solely responsible for
          reviewing, testing, and validating all outputs before production use.
        </P>
        <P>
          <strong>No IP indemnity:</strong> We provide no indemnification regarding the IP status of AI-generated
          outputs. You are responsible for ensuring generated code does not infringe third-party rights.
        </P>
        <P>
          <strong>Human review required:</strong> Blue Mantis requires explicit human approval before any code is
          committed. You acknowledge you have reviewed and approved all committed code.
        </P>
        <P>
          <strong>Training:</strong> We do not use your data to train AI models.
        </P>
      </Section>

      <Section id="integrations" n={8} title="Third-party integrations">
        <P>
          Your use of Jira, Azure DevOps, GitHub, Anthropic, OpenAI, and other connected services is subject to their
          own terms. You are responsible for having the right to connect these services and complying with their terms.
          Blue Mantis is not responsible for third-party service availability or security.
        </P>
      </Section>

      <Section id="payment" n={9} title="Payment and subscription">
        <P>
          Pricing available at kandryn.com. Changes notified 30 days in advance. Subscriptions billed in advance
          monthly or annually. Fees non-refundable except as required by law. Free plan limits may change at any time.
        </P>
        <P>Cancellation: access continues until end of billing period. You are responsible for all applicable taxes.</P>
      </Section>

      <Section id="availability" n={10} title="Service availability">
        <P>
          We target 99.9% monthly uptime but do not guarantee uninterrupted access. Downtime may occur for maintenance,
          emergencies, or factors outside our control. We provide advance notice for scheduled maintenance where
          possible.
        </P>
      </Section>

      <Section id="disclaimer" n={11} title="Disclaimer of warranties">
        <DisclaimerBox>
          THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
          IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT
          WARRANT THAT THE SERVICE WILL MEET YOUR REQUIREMENTS, BE UNINTERRUPTED OR ERROR-FREE, OR THAT AI-GENERATED
          OUTPUTS WILL BE ACCURATE OR FIT FOR PURPOSE.
        </DisclaimerBox>
      </Section>

      <Section id="liability" n={12} title="Limitation of liability">
        <DisclaimerBox>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, VENAKAN INFO SOLUTIONS LLC SHALL NOT BE LIABLE FOR INDIRECT,
          INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES. OUR TOTAL LIABILITY SHALL NOT EXCEED THE GREATER OF
          (A) THE AMOUNT YOU PAID IN THE TWELVE MONTHS PRECEDING THE CLAIM, OR (B) $100 USD.
        </DisclaimerBox>
      </Section>

      <Section id="indemnification" n={13} title="Indemnification">
        <P>
          You agree to indemnify Venakan Info Solutions LLC against claims arising from your use of the Service,
          violation of these Terms, violation of third-party rights, or content you provide.
        </P>
      </Section>

      <Section id="termination" n={14} title="Termination">
        <P>
          Either party may terminate at any time. You may terminate by deleting your account. We may suspend or terminate
          for Terms violations or risk to the Service. Sections 5, 6, 7, 11, 12, 13, and 15 survive termination.
        </P>
      </Section>

      <Section id="governing-law" n={15} title="Governing law">
        <P>
          Governed by the laws of Ohio, United States. Disputes resolved exclusively in state or federal courts in Ohio.
          Consumer protection laws in your jurisdiction may provide additional rights.
        </P>
      </Section>

      <Section id="changes" n={16} title="Changes to terms">
        <P>
          We notify users by email 30 days before material changes. Continued use after the effective date constitutes
          acceptance. Stop using the Service if you disagree with updated Terms.
        </P>
      </Section>

      <Section id="contact" n={17} title="Contact">
        <ContactBlock>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: '#2c3e50', margin: 0 }}>
            Legal questions: <Mail addr="legal@kandryn.com" />
            <br />
            General support: <Mail addr="support@kandryn.com" />
            <br />
            Venakan Info Solutions LLC · Ohio, United States
          </p>
        </ContactBlock>
      </Section>
    </LegalPage>
  );
}
