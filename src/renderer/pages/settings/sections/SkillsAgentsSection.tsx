import { useState } from 'react';

import GlobalAgentsPanel from '@/components/GlobalAgentsPanel';
import GlobalSkillsPanel from '@/components/GlobalSkillsPanel';
import type { CapabilityInitialSelect } from '@/../shared/skillsTypes';

interface SkillsAgentsSectionProps {
  initialSelect?: CapabilityInitialSelect;
}

export function SkillsAgentsSection({ initialSelect }: SkillsAgentsSectionProps) {
  const [skillsInDetail, setSkillsInDetail] = useState(false);
  const [agentsInDetail, setAgentsInDetail] = useState(false);

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-8 py-8">
      {!agentsInDetail && (
        <GlobalSkillsPanel onDetailChange={setSkillsInDetail} initialSelect={initialSelect} />
      )}
      {!skillsInDetail && (
        <GlobalAgentsPanel onDetailChange={setAgentsInDetail} initialSelect={initialSelect} />
      )}
    </div>
  );
}
