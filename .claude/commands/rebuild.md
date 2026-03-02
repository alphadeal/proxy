Build the project and restart the systemd service.

Steps:
1. Run `npm run build` in the project root `/home/bk/devel/proxy`
2. If the build fails, report the errors and stop — do NOT restart the service.
3. If the build succeeds, restart the service with `systemctl --user restart relayplane-proxy.service`
4. Verify the service is running with `systemctl --user is-active relayplane-proxy.service`
5. Show the last 20 lines of journal output with `journalctl --user -u relayplane-proxy.service -n 20 --no-pager`
6. Report the result: whether the build succeeded, whether the service is running, and any notable log output.
