import { ConfirmModal } from "@/components/ConfirmModal";

interface DeleteProjectDialogProps {
  open: boolean;
  project: { name: string; _count: { tasks: number } } | null;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/** The one confirm for deleting a project: the project page and the Projects list both use it. */
export function DeleteProjectDialog({
  open,
  project,
  busy = false,
  onClose,
  onConfirm,
}: DeleteProjectDialogProps) {
  if (!project) return null;
  const tasks = project._count.tasks;
  return (
    <ConfirmModal
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Delete project"
      body={`Delete project "${project.name}"? This permanently removes its ${tasks} ${
        tasks === 1 ? "task" : "tasks"
      }, sections, labels, notes, risks and reviews. There is no undo.`}
      confirmLabel="Delete"
      confirmTone="danger"
      busy={busy}
    />
  );
}
