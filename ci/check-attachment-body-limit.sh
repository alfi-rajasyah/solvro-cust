#!/usr/bin/env bash
# Asserts how the frontend runtime image turns ATTACHMENT_MAX_FILE_MB into the
# body limit of the attachment upload location: the value rounded up plus 1 MB,
# and 26m for an unset, empty or invalid value. Each case starts the image with
# `nginx -T`, so the entrypoint's 16-attachment-body-limit.envsh runs first and
# the rendered snippet is what gets inspected, plus nginx's own config test.
# No ports, no backend needed.
#
# Usage: ci/check-attachment-body-limit.sh [image]   (default: solvro-ci-frontend:latest)
# Local:  docker build --target runtime -t solvro-ci-frontend:latest frontend \
#           && ci/check-attachment-body-limit.sh
set -uo pipefail

IMAGE="${1:-solvro-ci-frontend:latest}"
FAILED=0

# Prints the rendered limit, or nothing when `nginx -T` failed its config test.
render() { # args: extra `docker run` args
  local out
  out=$(docker run --rm --add-host backend:127.0.0.1 "$@" "$IMAGE" nginx -T 2>&1)
  grep -q 'test is successful' <<<"$out" || return 0
  awk '/^# configuration file /{ f = ($0 ~ /attachment-body-limit\.conf:$/); next } f' <<<"$out" \
    | grep -o 'client_max_body_size [0-9]*m' | head -n 1
}

# check <label> <expected limit, e.g. 26m> [docker run args...]
check() {
  local label="$1" want="client_max_body_size $2"; shift 2
  local got
  got=$(render "$@")
  # A transient `docker run` failure renders nothing; retry once before judging.
  [[ -n "$got" ]] || { sleep 2; got=$(render "$@"); }
  if [[ "$got" == "$want" ]]; then
    echo "ok   $label"
  else
    echo "FAIL $label"
    echo "  want: $want"
    echo "  got:  ${got:-<nothing; nginx -T failed or the snippet is missing>}"
    FAILED=1
  fi
}

check "unset gives the default"           26m
check "empty gives the default"           26m  -e ATTACHMENT_MAX_FILE_MB=
check "25 (the default value)"            26m  -e ATTACHMENT_MAX_FILE_MB=25
check "100"                               101m -e ATTACHMENT_MAX_FILE_MB=100
check "0.5 rounds up"                     2m   -e ATTACHMENT_MAX_FILE_MB=0.5
check "25.2 rounds up"                    27m  -e ATTACHMENT_MAX_FILE_MB=25.2
check "zero is invalid"                   26m  -e ATTACHMENT_MAX_FILE_MB=0
check "negative is invalid"               26m  -e ATTACHMENT_MAX_FILE_MB=-3
check "text is invalid"                   26m  -e ATTACHMENT_MAX_FILE_MB=abc
check "exponent form is invalid"          26m  -e ATTACHMENT_MAX_FILE_MB=1e2
check "more than 6 digits is invalid"     26m  -e ATTACHMENT_MAX_FILE_MB=9999999

if [[ $FAILED -ne 0 ]]; then
  echo "attachment body limit check FAILED" >&2
  exit 1
fi
echo "attachment body limit check passed"
