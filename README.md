# lms-stats-service

This service shall help us to get some insight into how LMS is being used.
We want to know what platforms are the most important, what plugins popular,
and how quickly old Perl versions disappear. Among other things.

It provides and endpoint to which LMS will report its data. Another endpoint
returns aggregated information to be used to visualize the data. Another
scheduled task is run daily to aggregate the information for historical analysis.

The service is based around [Cloudflare](https://cloudflare.com)'s web services:

* [Workers to implement the handlers](https://developers.cloudflare.com/workers/)
* [D1 for data storage](https://developers.cloudflare.com/d1/)

