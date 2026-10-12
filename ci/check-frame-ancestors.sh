#!/usr/bin/env bash
# Asserts how the frontend runtime image turns EMBED_FRAME_ANCESTORS into the
# widened framing headers it renders for the framable /embed/ and /share/ pages: every unsafe,
# empty or unset value must collapse to `'self'` only (fail closed), and valid
# origins must pass through verbatim. Each case starts the image with
# `nginx -T`, so the entrypoint's validator and envsubst run first and the
# rendered map is what gets inspected — no ports, no backend needed.
#
# Usage: ci/check-frame-ancestors.sh [image]      (default: solvro-ci-frontend:latest)
# Local:  docker build --target runtime -t solvro-ci-frontend:latest frontend \
#           && ci/check-frame-ancestors.sh
set -uo pipefail

IMAGE="${1:-solvro-ci-frontend:latest}"
FAILED=0

# The two values the rendered widening map (frame-protection-embed-map.conf)
# assigns to the framable pages, as `nginx -T` dumps them: the regex key is cut
# off, leaving `"<CSP value>";` then `"<X-Frame-Options value>";`. (The `default`
# lines, i.e. every other URL, are fixed strict values and not templated.)
render() { # args: extra `docker run` args
  docker run --rm --add-host backend:127.0.0.1 "$@" "$IMAGE" nginx -T 2>&1 \
    | awk '/^# configuration file /{ f = ($0 ~ /frame-protection-embed-map\.conf:$/) ; next } f && /^[[:space:]]*"~\^/' \
    | sed -E 's/^[[:space:]]*"~[^"]*"[[:space:]]+//'
}

# check <label> <expected CSP value> <expected XFO value> [docker run args...]
check() {
  local label="$1" csp="$2" xfo="$3"; shift 3
  local want got
  want=$(printf '"%s";\n"%s";' "$csp" "$xfo")
  got=$(render "$@" | sed 's/^[[:space:]]*//')
  if [[ "$got" == "$want" ]]; then
    echo "ok   $label"
  else
    echo "FAIL $label"
    echo "  want: $(printf '%s' "$want" | tr '\n' '|')"
    echo "  got:  $(printf '%s' "$got" | tr '\n' '|')"
    FAILED=1
  fi
}

DISABLED_CSP="frame-ancestors 'self' "
long="https://a.example.com"; while [[ ${#long} -lt 2100 ]]; do long+=" https://a.example.com"; done

# Fail closed: embedding off, X-Frame-Options kept.
check "unset"                          "$DISABLED_CSP" "SAMEORIGIN"
check "empty"                          "$DISABLED_CSP" "SAMEORIGIN" -e EMBED_FRAME_ANCESTORS=
check "wildcard"                       "$DISABLED_CSP" "SAMEORIGIN" -e 'EMBED_FRAME_ANCESTORS=*'
check "directive injection"            "$DISABLED_CSP" "SAMEORIGIN" -e 'EMBED_FRAME_ANCESTORS=https://a.com;script-src *'
check "nginx syntax injection"         "$DISABLED_CSP" "SAMEORIGIN" -e 'EMBED_FRAME_ANCESTORS=https://a.com" always; add_header X 1'
check "scheme other than http(s)"      "$DISABLED_CSP" "SAMEORIGIN" -e 'EMBED_FRAME_ANCESTORS=javascript:alert(1)'
check "path in origin"                 "$DISABLED_CSP" "SAMEORIGIN" -e 'EMBED_FRAME_ANCESTORS=https://a.com/docs'
check "one bad entry voids the list"   "$DISABLED_CSP" "SAMEORIGIN" -e 'EMBED_FRAME_ANCESTORS=https://ok.example.com *'
check "over-long list (>2000 chars)"   "$DISABLED_CSP" "SAMEORIGIN" -e "EMBED_FRAME_ANCESTORS=$long"
check "raw value cannot bypass the validator" "$DISABLED_CSP" "SAMEORIGIN" -e 'EMBED_FRAME_ANCESTORS=*' -e 'EMBED_FRAME_ANCESTORS_SAFE=*'

# Valid: widened, X-Frame-Options dropped (empty value = header not sent).
check "single origin"                  "frame-ancestors 'self' https://docs.example.com" "" -e EMBED_FRAME_ANCESTORS=https://docs.example.com
check "list + trailing slash + port"   "frame-ancestors 'self' https://a.example.com http://b.example.com:8080" "" -e 'EMBED_FRAME_ANCESTORS=https://a.example.com/  http://b.example.com:8080'

if [[ $FAILED -ne 0 ]]; then
  echo "frame-ancestors checks FAILED"
  exit 1
fi
echo "frame-ancestors checks passed"
