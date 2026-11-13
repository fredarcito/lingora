import { useEffect, useRef, useState } from "react";
import { useT } from "@i18n";
import { Button, ConfirmDialog, IconButton, Menu, MenuItem, ChatIcon, MoreIcon, PlusIcon, TextField, cx, useDismiss } from "@components/shared";
import { chatGroups, TITLE_CHARS } from "@utils/chat.js";
import styles from "./styles.module.css";

/**
 * The Chat page's column of saved conversations: «Nuevo chat» on top, then
 * the chats grouped by day (today, yesterday, last 7 days, older), the open
 * one highlighted. Each has a ⋯ menu to rename it (in place) or delete it
 * (after confirming).
 * @param {{ chats: { id: string, title: string, updated_at: string }[], currentId: string | null,
 *   onNew: () => void, onOpen: (id: string) => void, onRename: (id: string, title: string) => void, onDelete: (id: string) => void,
 *   className?: string }} props
 */
export default function ChatList({ chats, currentId, onNew, onOpen, onRename, onDelete, className }) {
  const t = useT();
  const [menuFor, setMenuFor] = useState(/** @type {string | null} */ (null));
  const [renaming, setRenaming] = useState(/** @type {{ id: string, title: string } | null} */ (null));
  const [deleting, setDeleting] = useState(/** @type {string | null} */ (null));
  useDismiss(menuFor !== null, () => setMenuFor(null));
  const field = useRef(/** @type {HTMLDivElement | null} */ (null));
  useEffect(() => {
    if (renaming) field.current?.querySelector("input")?.select();
  }, [renaming?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    if (renaming && renaming.title.trim()) onRename(renaming.id, renaming.title);
    setRenaming(null);
  };

  return (
    <nav className={cx(styles.chatList, className)} aria-label={t("chat.all.chats")}>
      <Button className={styles.chatListNew} onClick={onNew}>
        <PlusIcon />
        {t("chat.all.newChat")}
      </Button>
      <div className={styles.chatListScroll}>
        {chats.length === 0 && <p className={cx("muted", styles.chatListEmpty)}>{t("chat.all.noChats")}</p>}
        {chatGroups(chats).map(({ group, chats: items }) => (
          <section key={group} className={styles.chatListGroup}>
            <h3>{t(`chat.all.group.${group}`)}</h3>
            <ul>
              {items.map((c) => (
                <li key={c.id} className={cx(styles.chatListItem, c.id === currentId && styles.isSelected)}>
                  {renaming?.id === c.id ? (
                    <div ref={field} className={styles.chatListRename}>
                      <TextField
                        value={renaming.title}
                        onChange={(title) => setRenaming({ id: c.id, title })}
                        onCommit={commit}
                        maxLength={TITLE_CHARS * 2}
                        label={t("chat.all.rename")}
                      />
                    </div>
                  ) : (
                    <>
                      <button type="button" className={styles.chatListOpen} aria-current={c.id === currentId ? "page" : undefined} onClick={() => onOpen(c.id)}>
                        <ChatIcon />
                        <span>{c.title || t("chat.all.untitled")}</span>
                      </button>
                      <div className={styles.chatListMenu}>
                        <IconButton
                          small
                          label={t("chat.more")}
                          aria-haspopup="menu"
                          aria-expanded={menuFor === c.id}
                          active={menuFor === c.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuFor((m) => (m === c.id ? null : c.id));
                          }}
                        >
                          <MoreIcon />
                        </IconButton>
                        {menuFor === c.id && (
                          <Menu align="end" role="menu">
                            <MenuItem
                              onClick={() => {
                                setMenuFor(null);
                                setRenaming({ id: c.id, title: c.title });
                              }}
                            >
                              {t("chat.all.rename")}
                            </MenuItem>
                            <MenuItem
                              danger
                              onClick={() => {
                                setMenuFor(null);
                                setDeleting(c.id);
                              }}
                            >
                              {t("chat.all.delete")}
                            </MenuItem>
                          </Menu>
                        )}
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {deleting && (
        <ConfirmDialog
          danger
          title={t("chat.all.deleteTitle")}
          body={t("chat.all.deleteBody")}
          cancelLabel={t("notes.cancel")}
          confirmLabel={t("chat.all.delete")}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            onDelete(deleting);
            setDeleting(null);
          }}
        />
      )}
    </nav>
  );
}
