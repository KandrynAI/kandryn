export interface TestCase {
  id: string;
  title: string;
  priority: 'high' | 'medium' | 'low';
  type: 'happy-path' | 'edge-case' | 'failure';
  given: string;
  when: string;
  then: string;
  assertion: string;
  tags: string[];
  selected?: boolean; // client-side only, not persisted
}
