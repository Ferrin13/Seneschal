# Seneschal — production deploy runbook

End-to-end steps to stand up the deal hunter (API + SPA + self-hosted
Temporal + worker + Facebook agent host) on AWS. Commands are **Windows
PowerShell**. Run everything from `infra/terraform/` unless noted.

Your environment (from `prod.tfvars`):

| Thing | Value |
|-------|-------|
| AWS profile / region | `seneschal` / `us-west-2` |
| API URL | `https://api.seneschal.parthadae.com` |
| Web URL | `https://seneschal.parthadae.com` |
| Agent host (SSH / tunnel) | `browser.parthadae.com` |
| Temporal (internal) | `temporal.parthadae.internal:7233` |
| Git branch pipelines track | `master` |

> **Facebook scraping model:** the browser runs on **your local machine**
> (logged into Facebook normally), and the agent host reaches it over an SSH
> reverse tunnel (`box 127.0.0.1:9222 -> your local Chrome CDP`). The EC2 box
> no longer runs Chrome/noVNC — it just runs the `scraper-agent` Temporal
> worker and is the SSH jump host. See §7 and `infra/local/fb-agent-tunnel.ps1`.

---

## 0. Pre-flight fixes (do these first)

- [ ] **`browser_allowed_cidrs`** is still the doc placeholder
  `203.0.113.4/32`. Set it to your real public IP(s) or you'll lock
  *yourself* out of SSH / the reverse tunnel (and leave it open to no one
  else). Find your IP: `(Invoke-RestMethod https://api.ipify.org)` then use
  `<ip>/32`.
- [ ] **`browser_ssh_public_key`** is set to your SSH public key
  (`~/.ssh/id_ed25519.pub`). It's how you open the reverse CDP tunnel to the
  agent host.
- [ ] **Scraper agent ships as a CI artifact** (no repo clone on the box).
  The `seneschal-agent` pipeline builds `agent/`, uploads
  `agent/latest/agent.tar.gz` to the `seneschal-agent-releases-*` S3 bucket,
  and SSM-redeploys the box. Works for a **private** repo (CodeStar handles
  auth) — you just need the branch pushed. Nothing to configure here.
- [ ] **`prod.tfvars` holds real secrets** (OpenRouter key, agent token).
  It's gitignored — confirm `git status` never shows it, and rotate the
  OpenRouter key if it has ever been shared.
- [ ] Repo is pushed to `github.com/Ferrin13/Seneschal` on branch `master`
  (the pipeline deploys from there — nothing ships until it's pushed).

Validate config before touching AWS:

```powershell
terraform fmt -recursive
terraform validate
```

---

## 1. One-time AWS account prep

### 1a. AWS credentials

```powershell
aws configure --profile seneschal      # or: aws configure sso --profile seneschal
aws sts get-caller-identity --profile seneschal
```

### 1b. Confirm the pre-existing dependencies

Terraform does **not** create these; they must already exist:

```powershell
# Route53 public hosted zone for parthadae.com
aws route53 list-hosted-zones-by-name --dns-name parthadae.com --profile seneschal --region us-west-2

# The app database secret referenced by database_url_secret_name
aws secretsmanager describe-secret --secret-id seneschal/prod/main-postgres-db --profile seneschal --region us-west-2
```

If the DB secret doesn't exist yet, create it (value = full
`postgres://…` connection string to your existing RDS):

```powershell
aws secretsmanager create-secret `
  --name seneschal/prod/main-postgres-db `
  --secret-string "postgres://USER:PASS@HOST:5432/seneschal" `
  --profile seneschal --region us-west-2
```

### 1c. Upload the Firebase service-account JSON to SSM

```powershell
aws ssm put-parameter `
  --name /seneschal/prod/firebase-service-account `
  --type SecureString `
  --value (Get-Content -Raw .\firebase-service-account.json) `
  --profile seneschal --region us-west-2
```

(OpenRouter key is supplied via the `openrouter_api_key` tfvar — Terraform
puts it in Secrets Manager for you.)

---

## 2. Bootstrap the Terraform state backend (one-time)

```powershell
cd bootstrap
terraform init
terraform apply
# note the state_bucket output, e.g. seneschal-tfstate-<account_id>-us-west-2
cd ..
```

---

## 3. Init + apply the main stack

```powershell
terraform init -backend-config="bucket=seneschal-tfstate-<account_id>-us-west-2"

terraform plan  -var-file=prod.tfvars
terraform apply -var-file=prod.tfvars
```

What this creates: ECR, ECS cluster + API service (blue/green) + ALB + ACM +
Route53, S3+CloudFront SPA, the **`parthadae` Temporal cluster** (ECS Fargate
`auto-setup` + dedicated RDS + Cloud Map DNS), the **`seneschal-worker`** ECS
service, the **browser box** EC2, both CodePipelines, and all security-group
wiring.

> **Expected on first apply:** the API and worker containers reference an ECR
> image tag (`:latest`) that doesn't exist until the first pipeline build, so
> those two services will **crash-loop until step 5 completes** — this is
> normal and `apply` will not block on it. Temporal comes up on its own once
> its RDS instance is ready (a few minutes).

Capture outputs:

```powershell
terraform output
# api_url, web_url, temporal_address, worker_service_name,
# temporal_cluster_name, browser_box_url, codestar_connection_arn, ...
```

---

## 4. Finish the GitHub connection (one-time, manual)

The CodeStar connection is created **PENDING**. In the AWS console:

> Developer Tools → Settings → Connections → `seneschal-github` →
> **Update pending connection** → install the AWS Connector GitHub App on
> `Ferrin13` (grant the `Seneschal` repo) → Save.

Verify:

```powershell
aws codestar-connections get-connection `
  --connection-arn (terraform output -raw codestar_connection_arn) `
  --profile seneschal --region us-west-2
# ConnectionStatus should be AVAILABLE
```

---

## 5. First deploy (kick the pipelines)

Pipelines trigger on pushes to `master` under `backend/**` / `frontend/**`.
For the very first run, either push a commit or start them manually:

```powershell
aws codepipeline start-pipeline-execution --name seneschal-backend  --profile seneschal --region us-west-2
aws codepipeline start-pipeline-execution --name seneschal-frontend --profile seneschal --region us-west-2
```

**Backend pipeline stages:** Source → Build (Docker → ECR) → **Migrate**
(drizzle) → **Deploy** (API blue/green) → **DeployWorker**
(`force-new-deployment` of `seneschal-worker` onto the new image).

Also start the **agent** pipeline so the browser box has an artifact to run
(otherwise its scraper-agent crash-loops until the first agent build):

```powershell
aws codepipeline start-pipeline-execution --name seneschal-agent --profile seneschal --region us-west-2
```

**Agent pipeline stages:** Source → Build (`npm ci && build`, tar → upload to
`agent/latest/agent.tar.gz` in the releases bucket) → Deploy (SSM RunCommand
tells the box to pull the artifact and restart the agent).

Watch them:

```powershell
aws codepipeline get-pipeline-state --name seneschal-backend --profile seneschal --region us-west-2
aws codepipeline get-pipeline-state --name seneschal-agent   --profile seneschal --region us-west-2
```

After the backend pipeline is green the API + worker stop crash-looping;
after the agent pipeline is green the browser box has the agent installed.

---

## 6. Verify Temporal + the worker

```powershell
# Temporal server task running?
aws ecs describe-services `
  --cluster (terraform output -raw temporal_cluster_name) `
  --services parthadae-temporal `
  --profile seneschal --region us-west-2 `
  --query "services[0].{running:runningCount,desired:desiredCount}"

# Worker task running + connected?
aws ecs describe-services `
  --cluster (terraform output -raw ecs_cluster_name) `
  --services (terraform output -raw worker_service_name) `
  --profile seneschal --region us-west-2 `
  --query "services[0].{running:runningCount,desired:desiredCount}"
```

Worker logs should show `Temporal worker listening on "deal-hunter"` and
`Synced N hunt schedule(s).`:

```powershell
aws logs tail /ecs/seneschal-worker --since 10m --follow --profile seneschal --region us-west-2
```

Temporal server logs (schema setup + frontend up):

```powershell
aws logs tail /ecs/parthadae-temporal --since 10m --profile seneschal --region us-west-2
```

> **Optional Temporal Web UI:** not deployed (internal cluster). To poke at
> it ad hoc, run `temporalio/ui` locally pointed at a port-forward, or add a
> UI service later — not required for operation.

---

## 7. Connect your local Chrome (Facebook scraping)

Facebook challenges datacenter IPs and headless/instrumented browsers, so the
agent drives a **real Chrome on your machine** over an SSH reverse tunnel. Set
this up once; the keep-alive script keeps it running.

1. **Dedicated Chrome + tunnel.** Run the keep-alive script from
   `infra/local/` (edit the defaults at the top if your zone/paths differ):

   ```powershell
   powershell -ExecutionPolicy Bypass -File ..\local\fb-agent-tunnel.ps1
   ```

   It launches an isolated Chrome (`--remote-debugging-port=9222`, profile
   `%USERPROFILE%\fb-scrape-profile`) and opens the reverse tunnel
   `ssh -N -R 9222:127.0.0.1:9222 ubuntu@browser.parthadae.com`, auto-reconnecting
   if it drops. To survive reboots, register it at logon (see the script's
   header for the `Register-ScheduledTask` snippet).

2. In that Chrome window, **log into Facebook** normally and finish any 2FA.
   The session persists in the dedicated profile.

3. Verify the box sees your Chrome (should print a `Windows` user-agent):

   ```powershell
   ssh ubuntu@browser.parthadae.com "curl -s http://127.0.0.1:9222/json/version"
   ```

4. The `scraper-agent` systemd unit (a Temporal worker on the `browser-box`
   queue) connects to `127.0.0.1:9222` → the tunnel → your Chrome, and serves
   Facebook activities automatically.

Shell onto the box via SSM if needed (no SSH key required):

```powershell
aws ssm start-session --target (terraform output -raw browser_box_instance_id) --profile seneschal --region us-west-2
# then: sudo systemctl status scraper-agent ; journalctl -u scraper-agent -f
```

---

## 8. Firebase + smoke test

1. **Firebase authorized domains:** in the Firebase console
   (`seneschal-c4b9a`) → Authentication → Settings → Authorized domains, add
   `seneschal.parthadae.com`.
2. **Health:**
   ```powershell
   Invoke-RestMethod https://api.seneschal.parthadae.com/healthz
   Invoke-RestMethod https://api.seneschal.parthadae.com/readyz
   ```
3. **App:** open `https://seneschal.parthadae.com`, sign in with an
   allowlisted Google account (`info@parthadae.com` / `12aplustech@gmail.com`).
4. **End-to-end hunt:** create a search target, then trigger a manual hunt
   (`POST /marketplace/targets/:id/hunt`) or wait for the schedule. Confirm
   the workflow runs (worker logs) and candidates/comps/evaluations land and
   show under `/deals`.

---

## 9. Android (if shipping the mobile client)

The release APK's `API_BASE_URL` is hardcoded to
`https://api.seneschal.parthadae.com/` — which matches this deploy. Ensure
the Android Firebase app is registered under project `seneschal-c4b9a`, then
build/sideload as usual. Not part of this Terraform/CI pipeline.

---

## Day-to-day & operations

- **Ship code:** push to `master`. `backend/**` → API blue/green + worker
  redeploy; `frontend/**` → S3 sync + CloudFront invalidation; `agent/**` →
  build artifact → S3 → SSM redeploy of the browser box.
- **Change worker/Temporal env or sizing:** edit `prod.tfvars` →
  `terraform apply` (these task defs are Terraform-owned, unlike the API's).
- **Restart the worker without a code change:**
  ```powershell
  aws ecs update-service --cluster (terraform output -raw ecs_cluster_name) `
    --service (terraform output -raw worker_service_name) `
    --force-new-deployment --profile seneschal --region us-west-2
  ```
- **Rollback the API:** use the CodeDeploy console (blue/green keeps the old
  task set ~5 min) or re-run the pipeline on a previous commit.

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| API/worker task stuck PENDING→STOPPED, "image not found" | First pipeline build hasn't run yet (step 5), or it failed. |
| Worker logs: `Connection refused` to Temporal | Temporal task not healthy yet, or SG rule missing — check `parthadae-temporal` service + `aws logs tail /ecs/parthadae-temporal`. |
| Worker: `Invalid environment configuration` | A required var (e.g. `DATABASE_URL`, `OPENROUTER_API_KEY`) not injected — check the worker task def / secrets. |
| Temporal task boot-loops | RDS not reachable — verify the Temporal DB SG and that `parthadae-temporal` RDS is `available`. |
| `scraper-agent` logs `ECONNREFUSED 127.0.0.1:9222` | The reverse tunnel isn't up — start `fb-agent-tunnel.ps1` on your machine (step 7). Verify with `ssh ubuntu@browser.parthadae.com "curl -s http://127.0.0.1:9222/json/version"`. |
| `scraper-agent` crash-loops with "cannot find dist/worker.js" | Agent artifact not deployed yet — run the `seneschal-agent` pipeline (step 5). On the box: `sudo /opt/browser/deploy-agent.sh`. |
| Facebook activities fail with `logged_out` | Your local Chrome's Facebook session expired — re-open the dedicated Chrome (step 7) and log back in. |
| Craigslist skipped | `craigslist_site` must be a non-empty slug (currently `boise`). |

## Teardown

```powershell
terraform destroy -var-file=prod.tfvars
```

Note: the Temporal RDS has `skip_final_snapshot = true` and
`deletion_protection = false` by default (flip
`temporal_db_deletion_protection = true` for long-lived prod). The app RDS,
Route53 zone, Firebase, and the SSM/DB secrets you created by hand are **not**
managed here and won't be destroyed.
