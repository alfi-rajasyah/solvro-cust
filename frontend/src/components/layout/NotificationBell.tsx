import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AssigneeAvatar } from "@/components/AssigneeAvatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtAgo, fmtDateTime } from "@/lib/formatDate";
import { describeNotification, notificationHref } from "@/lib/notificationText";
import {
  type AppNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from "@/lib/queries";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

/**
 * Top-bar bell (docs/archive/plans/collaboration-and-sharing.md, C5b): an unread
 * badge, and a popover list of the caller's notifications. Clicking a row marks
 * it read and opens the task (or the project).
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data: count = 0 } = useUnreadNotificationCount();
  const label = count > 0 ? `Notifications, ${count} unread` : "Notifications";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label={label}
        title="Notifications"
        data-testid="notifications-button"
        className={`relative flex h-8 w-8 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface ${FOCUS_RING}`}
      >
        <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
          notifications
        </span>
        {count > 0 && (
          <span
            aria-hidden="true"
            data-testid="notifications-badge"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-meta font-bold leading-none text-on-primary"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        positionerClassName="z-101"
        className="w-[min(24rem,calc(100vw-1rem))] p-0! shadow-overlay!"
        aria-label="Notifications"
      >
        <NotificationList unreadCount={count} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function NotificationList({
  unreadCount,
  onClose,
}: {
  unreadCount: number;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const items = useMemo(() => data?.pages.flatMap((p) => p.notifications) ?? [], [data]);

  function open(n: AppNotification) {
    if (n.readAt === null) markRead.mutate(n.id);
    onClose();
    navigate(notificationHref(n));
  }

  return (
    <div className="flex max-h-[min(32rem,calc(100vh-5rem))] flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-outline-variant px-3 py-2">
        <h2 className="text-label-caps uppercase text-on-surface-variant">Notifications</h2>
        <button
          type="button"
          onClick={() => markAll.mutate()}
          disabled={unreadCount === 0 || markAll.isPending}
          className={`rounded-sm text-xs font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:text-on-surface-variant disabled:no-underline ${FOCUS_RING}`}
        >
          Mark all as read
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2 p-3">
            <span className="sr-only">Loading notifications</span>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} aria-hidden="true" className="h-10 animate-pulse rounded-sm bg-surface-container-low" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex items-center gap-3 px-3 py-6 text-xs text-on-surface-variant">
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              error
            </span>
            <span>Could not load notifications.</span>
            <button
              type="button"
              onClick={() => void refetch()}
              className={`rounded-sm font-semibold text-primary hover:underline ${FOCUS_RING}`}
            >
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-3 py-10 text-center">
            <span className="material-symbols-outlined text-2xl text-on-surface-variant" aria-hidden="true">
              notifications_none
            </span>
            <p className="font-display text-sm font-semibold text-on-surface">You&apos;re all caught up</p>
            <p className="text-xs text-on-surface-variant">
              New assignments, comments and mentions show up here.
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-outline-variant">
              {items.map((n) => (
                <NotificationRow key={n.id} notification={n} onOpen={open} />
              ))}
            </ul>
            {hasNextPage && (
              <div className="flex justify-center border-t border-outline-variant p-2">
                <button
                  type="button"
                  onClick={() => void fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className={`rounded-lg border border-outline-variant px-3 py-1.5 text-xs font-semibold text-on-surface hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
                >
                  {isFetchingNextPage ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function NotificationRow({
  notification: n,
  onOpen,
}: {
  notification: AppNotification;
  onOpen: (n: AppNotification) => void;
}) {
  const unread = n.readAt === null;
  const sentence = describeNotification(n);

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(n)}
        data-testid="notification-item"
        data-unread={unread ? "true" : "false"}
        className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-surface-container-high ${FOCUS_RING} focus-visible:ring-inset`}
      >
        <span className="mt-0.5 shrink-0">
          {n.event.actor ? (
            <AssigneeAvatar user={n.event.actor} />
          ) : (
            <span
              className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant"
              title="Unknown user"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">
                person
              </span>
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block wrap-break-word text-sm text-on-surface ${unread ? "font-semibold" : ""}`}>
            {unread && <span className="sr-only">Unread: </span>}
            {sentence.text}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-meta text-on-surface-variant">
            <span className="min-w-0 truncate">{n.projectName}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={n.createdAt} title={fmtDateTime(n.createdAt)} className="shrink-0 whitespace-nowrap">
              {fmtAgo(n.createdAt)}
            </time>
          </span>
        </span>
        {unread && (
          <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />
        )}
      </button>
    </li>
  );
}
