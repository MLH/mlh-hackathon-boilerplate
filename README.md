# MLH/mlh-hackathon-boilerplate

This is a boilerplate template for any hackathon to use. It has a [configuration](_config.yml) that covers everything you'll want to make your hackathon website accessible, discoverable & ready for registration with our single sign on solution [MyMLH](https://my.mlh.io). It was first announced at [Hackcon EU 2016](https://hackcon.mlh.io/eu/) in Eindhoven, The Netherlands.

Click [here to view a demo](https://mlh.github.io/mlh-hackathon-boilerplate).

## Changelog

- (**30 Aug 2016**) Initial release of version 0.1.0

## Getting Started

1. Create a [GitHub](https://github.com/join) account if you haven't already.
2. Fork this repository to your own account. [Click here to do so](https://github.com/MLH/mlh-hackathon-boilerplate/fork).
3. Edit `_config.yml` to configure for your own hackathon website.
4. That's it - you should be able to access at `https://[github username].github.io/mlh-hackathon-boilerplate/`

### Setting up a custom domain

Want to configure for your own custom domain? Great! Through our excellent partners [Domain.com](https://domain.com/mlh), Major League Hacking is offering free domains to student hackathon organizers. Reach out to [hi@mlh.io](mailto:hi@mlh.io) to obtain your free coupon code.

1. Register your domain.
2. Update the domain `www` to `CNAME [github username].github.io`
3. Update the domain `@` to `A 192.30.252.153` and `A 192.30.252.154`
4. Update the `CNAME` in your GitHub fork of `mlh-hackathon-boilerplate` to your new domain (i.e. `examplehacks.com`)

[Reference: GitHub - Setting up an apex domain](https://help.github.com/articles/setting-up-an-apex-domain/)

### Setting up SSL

We'd highly recommend looking into [Cloudflare](http://cloudflare.com) for SSL with your domain. It's compatible with GitHub Pages and this project.

## Contributing

Our boilerplate is written entirely in Jekyll, which GitHub automatically compiles. This dramatically reduces the technical barrier needed to setup a hackathon website. We'd love to receive your contributions towards making this even better. A couple of things to note:

- GitHub's variant of Jekyll doesn't allow custom plugins. We can't accept Jekyll plugins for this reason.
- Please ensure you have the correct permissions inside all of your PRs.
- Before creating a PR, it would be better if you created a GitHub Issue explaining the contribution. This isn't required, but advised.
