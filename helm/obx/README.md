# OBX Helm Chart

Deploys the OBX Conditions app as a single `prod` environment.

```bash
helm upgrade --install obx-prod helm/obx \
  --namespace obx-prod \
  --create-namespace \
  -f helm/values/obx/values-prod.yaml
```

The chart exposes the app through the Tailscale Kubernetes Operator using a Tailscale `Ingress` and Funnel. The rendered `Ingress` sets:

- `spec.ingressClassName: tailscale`
- `metadata.annotations["tailscale.com/funnel"]: "true"`
- `spec.tls.hosts[0]` to the configured Tailscale machine-name label

Cluster/tailnet prerequisites are intentionally outside the chart: install the Tailscale Kubernetes Operator, enable MagicDNS and HTTPS for the tailnet, and grant the `funnel` node attribute to the operator proxy tag such as `tag:k8s`.
