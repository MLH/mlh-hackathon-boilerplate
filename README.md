# MLH/mlh-hackathon-boilerplate

This is a hackathon boilerplate created by [Major League Hacking][mlh-github]. Using [Jekyll][jekyll], it has a extensible [configuration][config] that covers basic event information. You can then fork the website and have it hosted free through [GitHub Pages][github-pages]. It's free to use.

Advantages:

- Built in support for [MyMLH][my-mlh]
- Community-owned and maintained
- Free hosting through [GitHub Pages][github-pages]
- Discoverable through Google Search, Twitter and Facebook

[mlh-github]: https://github.com/MLH
[jekyll]: https://jekyllrb.com
[config]: _config.yml
[github-pages]: https://pages.github.com
[my-mlh]: https://my.mlh.io

## Getting Started

1. Create a [GitHub][create-account] account if you haven't already.
2. Fork this repository to your own account. [Click here to fork this repo][fork-repo].
3. Edit [`_config.yml`][config] to configure for your own hackathon website.
4. That's it - you should be able to access at `https://[github username].github.io/mlh-hackathon-boilerplate/`

[create-account]: https://github.com/join
[fork-repo]: https://github.com/MLH/mlh-hackathon-boilerplate/fork

### Setting up a custom domain

Want to configure for your own custom domain? Great! Through our excellent partners [Domain.com][domain-com], Major League Hacking is offering free domains to student hackathon organizers. Reach out to [hi@mlh.io][email-mlh] to obtain your free coupon code.

1. Register your domain.
2. Update the domain `www` to `CNAME [github username].github.io`
3. Update the domain `@` to `A 192.30.252.153` and `A 192.30.252.154`
4. Update the `CNAME` in your GitHub fork of `mlh-hackathon-boilerplate` to your new domain (i.e. `examplehacks.com`)

[Reference: GitHub - Setting up an apex domain][github-apex-domain]

[domain-com]: https://domain.com/mlh
[email-mlh]: mailto:hi@mlh.io
[github-apex-domain]: https://help.github.com/articles/setting-up-an-apex-domain/

### Setting up SSL

We'd highly recommend looking into [Cloudflare][cloudflare] for SSL with your domain. It's compatible with [GitHub Pages][github-pages] and this project.

[cloudflare]: https://cloudflare.com

## Contributing

Our boilerplate is written entirely in [Jekyll][jekyll], which GitHub automatically compiles. This dramatically reduces the technical barrier needed to setup a hackathon website. We'd love to receive your contributions towards making this even better. A couple of things to note:

- We can't accept custom plugins because it's not supported by [GitHub Pages][github-pages].
- If adding any external images or components, please ensure you have the correct permission to use them.
- We advise creating a GitHub issue first explaining the issue.
