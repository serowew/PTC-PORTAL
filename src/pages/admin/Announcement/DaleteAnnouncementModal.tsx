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
      >
        {/* =============================================
            ICON
        ============================================= */}

        <div className="delete-announcement-modal__icon">
          <span>!</span>
        </div>

        {/* =============================================
            CONTENT
        ============================================= */}

        <div className="delete-announcement-modal__content">
          <h2 id="delete-announcement-title">{title}</h2>

          <p>Are you sure you want to delete this announcement?</p>

          {announcementTitle && (
            <div className="delete-announcement-modal__announcement">
              “{announcementTitle}”
            </div>
          )}

          <p className="delete-announcement-modal__warning">
            This action cannot be undone.
          </p>
        </div>

        {/* =============================================
            ACTIONS
        ============================================= */}

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
            {isDeleting ? "Deleting..." : "Delete Announcement"}
          </button>
        </div>
      </div>
    </div>
  );
}
