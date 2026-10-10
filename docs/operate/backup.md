# Back up and restore the CMS

**Kind:** how-to. Goal: keep a copy of everything the CMS holds, and put it back.

## What holds the state

| Part     | State                                                                                                                          | Back it up?                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Database | Content, users, comments, newsletter subscribers and, with the fediverse on, followers, the actor's key pair and interactions. | **Yes.** It is the main copy of the site.                           |
| Uploads  | The media files: a volume at `/app/public/uploads`, or the bucket if you set `R2_*`.                                           | **Yes**, the volume or the bucket.                                  |
| Secrets  | Strapi's keys, `ENCRYPTION_KEY` and the API token values.                                                                      | **Yes**, in a secret store outside the repository, with the backup. |

Without the same keys a restored database may not open, so keep them with the database backup. Never put them in the repository, a log or an issue.

## The scripts

`scripts/backup-volumes.sh` and `scripts/restore-volumes.sh` back up a Docker Compose deployment: a `pg_dump` of the database, compressed, and a tarball of the uploads volume. They look for a service named `db`, a service named `strapi` and a volume named `<COMPOSE_PROJECT>_strapi-uploads`; if your Compose file names them differently, the script skips that part and prints a warning, so read its output.

| Variable                             | Meaning                                         | Default (in the script)                  |
| ------------------------------------ | ----------------------------------------------- | ---------------------------------------- |
| `COMPOSE_PROJECT`                    | The Compose project name                        | Set it: the default is a historical name |
| `BACKUP_DIR`                         | Where backups are written                       | Set it: the default is a historical path |
| `RETENTION_DAYS`                     | Backups older than this are deleted after a run | 14                                       |
| `DATABASE_USERNAME`, `DATABASE_NAME` | The PostgreSQL user and database                | `strapi`                                 |

```bash
COMPOSE_PROJECT=my-site BACKUP_DIR=/srv/backups/my-site ./scripts/backup-volumes.sh
```

Run it from cron or your host's scheduler. Copy the result off the machine that runs the site.

## Restore

```bash
COMPOSE_PROJECT=my-site BACKUP_DIR=/srv/backups/my-site ./scripts/restore-volumes.sh latest
# or an exact backup: ./scripts/restore-volumes.sh 20260101-120000
```

It asks for confirmation, stops the CMS, **drops and recreates the `public` schema**, loads the dump, replaces the uploads and starts the CMS again. Restore into the environment you want to overwrite, with the secrets of the backup. Then check `/_health`, sign in to `/admin` and open an article with an image.

## Test the restore

A backup nobody has restored is a hope. Restore it into a throwaway project at least once, and after any change in how you back up.

## If you use a managed database or bucket

Use the provider's backups for the database and the bucket instead of the scripts, and keep the secrets as above. The scripts exist for the Compose setup.
