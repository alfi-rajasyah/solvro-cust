import { useEffect, type ReactNode } from "react";
import { useLocation, useParams } from "react-router-dom";
import { TableSkeleton } from "@/components/skeletons";
import { SkeletonRegion } from "@/components/skeletons/SkeletonRegion";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { embedSignInHref } from "@/lib/embedViews";
import { type ProjectDetail, useProject } from "@/lib/queries";
import {
  EMBED_BUTTON_PRIMARY,
  EMBED_BUTTON_SECONDARY,
  EmbedExternalLink,
  EmbedFrame,
  EmbedMessage,
} from "./EmbedParts";

// The shared shell of every /embed/projects/:id/* route. It sits OUTSIDE the
// app Shell (no sidebar, top bar, install banner, command palette or
// notification polling) and settles who the viewer is before any view mounts:
//
//   no session / session ended -> "Sign in to Solvro" card (never the login
//                                 form: Google sign-in refuses to run in a frame)
//   project not visible        -> "You don't have access" (404 and 403 alike,
//                                 so nothing leaks beyond the API's own 404)
//   otherwise                  -> the view, given the loaded project
//
// Embeds use the normal Solvro session (same-site storage; Outline on another
// site simply lands in the sign-in card). Read-only: no mutation hook is
// reachable from here.

/** Keeps crawlers away from every embed state, signed in or not. */
function useEmbedNoindex() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}

/** A useful tab title while the project's embed is open. */
function useEmbedTitle(title: string | null) {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} · Solvro` : "Solvro";
    return () => {
      document.title = previous;
    };
  }, [title]);
}

function EmbedSkeleton() {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-outline-variant bg-surface-container-low px-3 py-2.5">
        <Skeleton className="h-5 w-5" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="p-3">
        <TableSkeleton rows={4} columns={4} widths={["w-3/4", "w-16", "w-8", "w-12"]} />
      </div>
    </>
  );
}

/** Inline loading placeholder for a view's own data, once the project is known. */
export function EmbedBodySkeleton() {
  return (
    <SkeletonRegion className="space-y-2 p-3">
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-2/3" />
    </SkeletonRegion>
  );
}

function SignInCard({ embedPath }: { embedPath: string }) {
  return (
    <EmbedMessage
      icon="lock"
      title="Sign in to Solvro to see this"
      hint="This view uses your Solvro session. Sign in in a new tab, then reload."
      testId="embed-signin"
    >
      <EmbedExternalLink
        href={embedSignInHref(embedPath)}
        testId="embed-signin-link"
        className={EMBED_BUTTON_PRIMARY}
      >
        Sign in
        <span className="material-symbols-outlined text-base" aria-hidden="true">
          open_in_new
        </span>
      </EmbedExternalLink>
      <button
        type="button"
        data-testid="embed-reload"
        onClick={() => window.location.reload()}
        className={EMBED_BUTTON_SECONDARY}
      >
        Reload
      </button>
    </EmbedMessage>
  );
}

function ProjectGate({
  projectId,
  children,
}: {
  projectId: number | null;
  children: (project: ProjectDetail) => ReactNode;
}) {
  const { data: project, error, isLoading, refetch } = useProject(projectId);
  useEmbedTitle(project?.name ?? null);

  if (projectId === null) {
    return (
      <EmbedMessage
        icon="link_off"
        title="This embed link is not valid"
        hint="The project in the link could not be found."
        testId="embed-invalid"
        role="alert"
      />
    );
  }
  if (project) return <>{children(project)}</>;
  if (isLoading) return <EmbedSkeleton />;

  const status = error instanceof ApiError ? error.status : null;
  if (status === 404 || status === 403) {
    return (
      <EmbedMessage
        icon="block"
        title="You don't have access to this project"
        hint="Ask the project's TAM to add you, or open Solvro to check your account."
        testId="embed-no-access"
        role="alert"
      />
    );
  }
  return (
    <EmbedMessage
      icon="error"
      title="This view could not be loaded"
      hint="Check your connection and try again."
      testId="embed-error"
      role="alert"
    >
      <button type="button" onClick={() => void refetch()} className={EMBED_BUTTON_SECONDARY}>
        Try again
      </button>
    </EmbedMessage>
  );
}

export function EmbedScreen({
  children,
}: {
  children: (project: ProjectDetail) => ReactNode;
}) {
  const { id } = useParams<{ id: string }>();
  const { status } = useAuth();
  const { pathname, search } = useLocation();
  const projectId = id && /^\d+$/.test(id) ? Number(id) : null;
  useEmbedNoindex();

  let body: ReactNode;
  if (status === "loading") body = <EmbedSkeleton />;
  else if (status === "unauthenticated") body = <SignInCard embedPath={pathname + search} />;
  else body = <ProjectGate projectId={projectId}>{children}</ProjectGate>;

  return <EmbedFrame>{body}</EmbedFrame>;
}
