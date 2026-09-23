import { AlertTriangle, LoaderCircle, Trash2, X } from "lucide-react";

import "../../../styles/deleteannouncementmodal.css";

type DeleteAnnouncementModalProps = {
  isOpen: boolean;
  title?: string;
  announcementTitle?: string;
  isDeleting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function DeleteAnnouncementModal({
  isOpen,
  title = "Delete Announcement",
  announcementTitle,
  isDeleting = false,
  onCancel,
  onConfirm,
}: DeleteAnnouncementModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="delete-announcement-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isDeleting) {
          onCancel();
        }
      }}
    >
      <div
        className="delete-announcement-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-announcement-title"
        aria-describedby="delete-announcement-description"
      >
        <button
          type="button"
          className="delete-announcement-modal__close"
          onClick={onCancel}
          disabled={isDeleting}
          aria-label="Close delete announcement confirmation"
        >
          <X size={16} aria-hidden="true" />
        </button>

        <div className="delete-announcement-modal__header">
          <span className="delete-announcement-modal__icon" aria-hidden="true">
            <Trash2 size={20} />
          </span>

          <div className="delete-announcement-modal__heading">
            <span className="delete-announcement-modal__eyebrow">
              Announcement Management
            </span>
            <h2 id="delete-announcement-title">{title}</h2>
          </div>
        </div>

        <div className="delete-announcement-modal__content">
          <p id="delete-announcement-description">
            Are you sure you want to delete this announcement?
          </p>

          {announcementTitle && (
            <div className="delete-announcement-modal__announcement">
              <span>Selected announcement</span>
              <strong>“{announcementTitle}”</strong>
            </div>
          )}

          <div className="delete-announcement-modal__warning">
            <AlertTriangle size={16} aria-hidden="true" />
            <p>This action cannot be undone.</p>
          </div>
        </div>

        <div className="delete-announcement-modal__actions">
          <button
            type="button"
            className="delete-announcement-modal__cancel"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </button>

          <button
            type="button"
            className="delete-announcement-modal__delete"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <>
                <LoaderCircle
                  size={15}
                  className="delete-announcement-modal__spinner"
                  aria-hidden="true"
                />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 size={15} aria-hidden="true" />
                Delete Announcement
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
