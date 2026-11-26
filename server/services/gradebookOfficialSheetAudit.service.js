export function inspectOfficialSheetAudit(sheet, events, requests = []) {
  const invalid = () => ({
    valid: false,
    state: "INVALID",
    recorded: null,
    verified: null,
  });

  const present = (value) =>
    typeof value === "string" && value.trim().length > 0;

  const id = (value) => value != null && /^[1-9]\d*$/.test(String(value));

  const same = (a, b) => id(a) && id(b) && String(a) === String(b);

  const sourceMatches = (a, b) =>
    a.original_date === b.original_date &&
    a.official_submission_reference === b.official_submission_reference;

  if (!sheet || !id(sheet.sheet_id)) {
    return invalid();
  }

  let state = "BLANK";
  let version = 1;
  let recorded = null;
  let verified = null;

  const usedRequests = new Set();

  // Validate the complete submission event history.
  for (const event of events) {
    const first = recorded === null && version === 1 && state === "BLANK";

    if (
      !same(event.sheet_id, sheet.sheet_id) ||
      !id(event.event_id) ||
      !id(event.performed_by_user_id) ||
      !present(event.original_date) ||
      !present(event.official_submission_reference) ||
      (first
        ? event.previous_record_version !== null
        : Number(event.previous_record_version) !== version) ||
      Number(event.record_version_after) !== (first ? 1 : version + 1)
    ) {
      return invalid();
    }

    // Initial recording or recording after reopening.
    if (state === "BLANK" && event.event_type === "RECORDED") {
      recorded = event;
      state = "RECORDED";
    }

    // Only an unverified recording may be reopened.
    else if (state === "RECORDED" && event.event_type === "REOPENED") {
      const matches = requests.filter((request) =>
        same(request.reopened_event_id, event.event_id),
      );

      const request = matches[0];

      if (
        matches.length !== 1 ||
        request.request_status !== "APPROVED" ||
        !same(request.sheet_id, sheet.sheet_id) ||
        !id(request.reopen_request_id) ||
        !same(request.recording_event_id, recorded.event_id) ||
        Number(request.expected_sheet_version) !== version ||
        !same(request.reviewed_by_user_id, event.performed_by_user_id) ||
        !id(request.requested_by_user_id) ||
        same(request.requested_by_user_id, request.reviewed_by_user_id) ||
        !present(request.request_reason) ||
        !present(request.decision_reason) ||
        !request.reviewed_at ||
        !sourceMatches(event, recorded) ||
        usedRequests.has(String(request.reopen_request_id))
      ) {
        return invalid();
      }

      usedRequests.add(String(request.reopen_request_id));

      recorded = null;
      state = "BLANK";
    }

    // Verify the current active recording.
    else if (state === "RECORDED" && event.event_type === "VERIFIED") {
      if (
        !sourceMatches(event, recorded) ||
        same(event.performed_by_user_id, recorded.performed_by_user_id)
      ) {
        return invalid();
      }

      verified = event;
      state = "VERIFIED";
    } else {
      return invalid();
    }

    version = Number(event.record_version_after);
  }

  // Every approved reopening must have a matching event.
  if (
    requests.some(
      (request) =>
        request.request_status === "APPROVED" &&
        !usedRequests.has(String(request.reopen_request_id)),
    )
  ) {
    return invalid();
  }

  // Match the current sheet against its audit history.
  const finalized = sheet.sheet_status === "FINALIZED";

  if (!finalized && sheet.sheet_status !== "IN_PROGRESS") {
    return invalid();
  }

  if (Number(sheet.record_version) !== version + (finalized ? 1 : 0)) {
    return invalid();
  }

  if (
    finalized &&
    (state !== "VERIFIED" ||
      !sheet.finalized_at ||
      !id(sheet.finalized_by_user_id))
  ) {
    return invalid();
  }

  if (
    !finalized &&
    (sheet.finalized_at != null ||
      sheet.finalized_by_user_id != null ||
      sheet.finalized_roster_count != null)
  ) {
    return invalid();
  }

  // Reopened sheets must have no active submission evidence.
  if (state === "BLANK") {
    if (
      sheet.original_date != null ||
      sheet.official_submission_reference != null
    ) {
      return invalid();
    }
  } else if (!sourceMatches(recorded, sheet)) {
    return invalid();
  }

  // Verification must match the active recording.
  if (state === "VERIFIED") {
    if (
      !sheet.official_date_verified_at ||
      !same(
        sheet.official_date_verified_by_user_id,
        verified.performed_by_user_id,
      )
    ) {
      return invalid();
    }
  } else if (
    sheet.official_date_verified_at != null ||
    sheet.official_date_verified_by_user_id != null
  ) {
    return invalid();
  }

  return {
    valid: true,
    state: finalized ? "FINALIZED" : state,
    recorded,
    verified,
  };
}
