# Verify the image

Every image that CI publishes to `ghcr.io/bogd3v/micelio-cms` carries two things you can check before you run it: a signed build provenance attestation and a software bill of materials (SBOM). Neither changes the image contents or its tags.

## What is attached

| Item                   | What it tells you                                                    | Made by                                                             |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Provenance attestation | This repository's workflow built this exact digest, from this commit | `actions/attest-build-provenance`, signed with Sigstore             |
| SBOM (SPDX)            | The packages inside the image                                        | BuildKit (`sbom: true`), stored as an attestation of the same image |
| BuildKit provenance    | The build inputs and steps (SLSA, `mode=max`)                        | BuildKit (`provenance: mode=max`)                                   |

## Verify the provenance

Needs the [GitHub CLI](https://cli.github.com/) and a login to GHCR if the package is private.

```bash
gh attestation verify oci://ghcr.io/bogd3v/micelio-cms:<tag> --repo bogd3v/micelio-cms
```

`<tag>` is a release tag or a commit SHA. The command exits 0 and prints the workflow and commit that built the digest when the attestation is valid. Any other exit code means do not run the image.

## Print the bill of materials

```bash
docker buildx imagetools inspect ghcr.io/bogd3v/micelio-cms:<tag> --format '{{ json .SBOM }}'
```

The output is SPDX JSON. Pipe it to `jq '.SPDX.packages[].name'` for a list of package names.

## Notes

- Verify the tag you deploy. Tags such as `latest` move; the digest in the output is what was checked.
- A registry listing shows extra `unknown/unknown` entries next to the image. Those are the attestation manifests, not other platforms.
