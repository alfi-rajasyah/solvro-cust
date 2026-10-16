import { useMemo } from "react";
import {
  EMBED_BUTTON_SECONDARY,
  EmbedExternalLink,
  EmbedFooter,
  EmbedHeader,
  EmbedMessage,
} from "@/components/embed/EmbedParts";
import { EmbedBodySkeleton, EmbedScreen } from "@/components/embed/EmbedScreen";
import { PhaseBarList } from "@/components/embed/PhaseBarList";
import { dateToDay } from "@/lib/dateField";
import { deriveEmbedPhases, embedOpenHref } from "@/lib/embedViews";
import { type ProjectDetail, useProjectSections, useProjectTasks } from "@/lib/queries";
import { timelineLayout } from "@/lib/shareLinks";

// /embed/projects/:id/timeline — read-only phase bars. The in-app Timeline tab
// is a task-level vertical list with edit controls, which does not fit a
// compact read-only frame; the guest timeline's bar list (phases = sections,
// dates and status derived from their tasks, laid out by `timelineLayout`) does,
// so this is that bar list fed from the signed-in APIs.

export function EmbedTimeline() {
  return <EmbedScreen>{(project) => <TimelineView project={project} />}</EmbedScreen>;
}

function TimelineView({ project }: { project: ProjectDetail }) {
  const tasksQ = useProjectTasks(project.id);
  const sectionsQ = useProjectSections(project.id);
  const todayDay = dateToDay(new Date());

  const phases = useMemo(
    () => deriveEmbedPhases(sectionsQ.data ?? [], tasksQ.data ?? []),
    [sectionsQ.data, tasksQ.data],
  );
  const layout = useMemo(() => timelineLayout(phases, todayDay), [phases, todayDay]);

  const isLoading = tasksQ.isLoading || sectionsQ.isLoading;
  const isError = !isLoading && (tasksQ.isError || sectionsQ.isError);

  return (
    <>
      <EmbedHeader title={project.name} subtitle="Timeline" />
      {isLoading ? (
        <EmbedBodySkeleton />
      ) : isError ? (
        <EmbedMessage
          icon="error"
          title="The timeline could not be loaded"
          hint="Check your connection and try again."
          testId="embed-error"
          role="alert"
        >
          <button
            type="button"
            onClick={() => {
              void tasksQ.refetch();
              void sectionsQ.refetch();
            }}
            className={EMBED_BUTTON_SECONDARY}
          >
            Try again
          </button>
        </EmbedMessage>
      ) : phases.length === 0 ? (
        <EmbedMessage
          icon="timeline"
          title="No phases have been planned yet"
          testId="embed-empty"
          role="status"
        />
      ) : (
        <PhaseBarList
          phases={phases}
          layout={layout}
          testId="embed-timeline"
          itemTestId="embed-phase"
        />
      )}
      <EmbedFooter>
        <EmbedExternalLink
          href={embedOpenHref(project.id)}
          testId="embed-open"
          className="font-semibold text-primary hover:underline"
        >
          Open in Solvro to edit
        </EmbedExternalLink>
      </EmbedFooter>
    </>
  );
}
