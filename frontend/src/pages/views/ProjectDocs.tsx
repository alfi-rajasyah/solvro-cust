import { useProjectContext } from "../ProjectDetail";
import { OutlineDocsTab } from "@/components/outline/OutlineDocsTab";
import { hasPermission, useAuth } from "@/lib/auth";

// Project › Docs: the Outline pages under the project's own link
// (docs/archive/plans/outline-integration.md, B6). Creating pages needs the same
// permission as editing the project.
export function ProjectDocs() {
  const { project } = useProjectContext();
  const { user } = useAuth();
  return (
    <OutlineDocsTab
      scope="projects"
      id={project.id}
      outlineUrl={project.outlineUrl}
      canWrite={hasPermission(user, "project:write")}
    />
  );
}
