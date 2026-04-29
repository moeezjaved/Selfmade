c = open('src/app/(dashboard)/insights/page.tsx').read()
c = c.replace("fetch(`/api/insights/campaigns?dateRange=${dateRange}`)", "fetch('/api/insights/campaigns?dateRange=' + dateRange)")
open('src/app/(dashboard)/insights/page.tsx', 'w').write(c)
print('fixed')
