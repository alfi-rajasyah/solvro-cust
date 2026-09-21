// "No customer" group (spec §6.3 pin 8): projects with `customerId: null`.
// Each card renders its own assign-a-customer banner (`ProjectCard`'s
// `unassigned` prop) — there's no operations card or weekly-update block
// here (Decision 3: weekly updates are per customer).
import type { DailyReviewProject } from "@/lib/queries";
import { ProjectCard } from "./ProjectCard";

export interface UnassignedGroupProps {
  projects: DailyReviewProject[];
  today: string;
  days: string[];
  currentUserId: number;
  canDeleteAny: boolean;
  firstProjectId: number | null;
  focusRequest: { day: string; token: number } | null;
}

export function UnassignedGroup({
  projects,
  today,
  days,
  currentUserId,
  canDeleteAny,
  firstProjectId,
  focusRequest,
}: UnassignedGroupProps) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-base font-semibold text-on-surface">No customer</h2>
      <div className="space-y-3">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            today={today}
            days={days}
            currentUserId={currentUserId}
            canDeleteAny={canDeleteAny}
            isFirstCard={project.id === firstProjectId}
            focusRequest={focusRequest}
            unassigned
          />
        ))}
      </div>
    </section>
  );
}
