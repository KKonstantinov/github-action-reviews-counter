import fs from 'fs'
import * as core from '@actions/core'
import { getOctokit } from '@actions/github'

const { GITHUB_EVENT_PATH, GITHUB_REPOSITORY } = process.env as { GITHUB_EVENT_PATH: string; GITHUB_REPOSITORY: string }

const { debug } = core

const run = async () => {
  try {
    const client = getOctokit(core.getInput('repo-token', { required: true }))

    const ghEvent = JSON.parse(await fs.promises.readFile(GITHUB_EVENT_PATH, 'utf8')) as {}
    const prData = isPullRequest(ghEvent)
      ? ghEvent.pull_request
      : isPullRequestReview(ghEvent)
      ? ghEvent.pull_request_review.pull_request
      : undefined

    if (prData === undefined) {
      throw new Error('Failed to extract pull request data.')
    }

    const prNumber = prData.number
    const [repoOwner, repoName] = 'SpinUp-Digital/galeries-lafayette-sfcc'.split('/')
    const queryVars: Record<string, { type: string; value: unknown }> = {
      repoOwner: { type: 'String!', value: repoOwner },
      repoName: { type: 'String!', value: repoName },
      prNumber: { type: 'Int!', value: prNumber }
    }

    const queryArgs: string = Object.entries(queryVars)
      .map(([argName, { type }]) => `$${argName}: ${type}`)
      .join(', ')

    const query = `
      query GetCollaboratorApprovedPrReviewCount(${queryArgs}) {
        repository(owner: $repoOwner, name: $repoName) {
          pullRequest(number: $prNumber) {
            reviews(first: 100) {
              nodes {
                author {
                  login
                }
                authorAssociation
                state
                submittedAt
              }
            }
          }
        }
      }
    `

    const vars: Record<string, unknown> = Object.fromEntries(
      Object.entries(queryVars).map(([varName, { value }]) => [varName, value])
    )

    debug(`Using query:\n${query}`)
    debug(`Variables: ${JSON.stringify(vars, undefined, 2)}`)

    const data: {
      repository: {
        pullRequest: {
          reviews: {
            nodes: {
              state: ReviewState,
              author: {
                login: string
              },
              submittedAt: string
            }[]
          }
        }
      }
    } = await client.graphql(query, vars)

    // const reviews = data.repository.pullRequest.reviews.nodes.filter(review =>
    //   {
    //     console.log(review)
    //     return true;
    //   }
    // )

    /**
     * START OF Just get the latest review from each author.
     */
    /**
     * @typedef {Object} Review
     */
    type Review = {
      author: {
        login: string;
      };
      state: ReviewState;
      submittedAt: string;
    };
    
    const sortedReviews = data.repository.pullRequest.reviews.nodes.sort((a: Review, b: Review) =>
      new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
    
    const latestReviewsByAuthor: Record<string, Review> = sortedReviews.reduce((acc: Record<string, Review>, review: Review) => {
      if (!acc[review.author.login] || new Date(acc[review.author.login].submittedAt).getTime() < new Date(review.submittedAt).getTime()) {
        acc[review.author.login] = review;
      }
      return acc;
    }, {});
    
    const reviews: Review[] = Object.values(latestReviewsByAuthor);

    /**
     * END OF Just get the latest review from each author.
     */

    debug(`${reviews.length} total valid reviews`)
    Object.keys(ReviewState)
      .filter(key => /^[a-zA-Z_]+$/.test(key))
      .forEach(stateName => {
        const stateReviewsCount = reviews.filter(review => review.state === ((stateName as unknown) as ReviewState))
          .length
        const outputKey = stateName.toUpperCase()
        debug(`  ${outputKey}: ${stateReviewsCount.toLocaleString('en')}`)
        //core.setOutput(outputKey, stateReviewsCount)
        core.exportVariable('REVIEW_COUNTER_'+outputKey, stateReviewsCount)
      })
  } catch (err) {
    core.setFailed(err)
  }
}

enum ReviewState {
  APPROVED = 'APPROVED',
  CHANGES_REQUESTED = 'CHANGES_REQUESTED',
  COMMENTED = 'COMMENTED',
  DISMISSED = 'DISMISSED',
  PENDING = 'PENDING'
}

enum CommentAuthorAssociation {
  COLLABORATOR = 'COLLABORATOR',
  CONTRIBUTOR = 'CONTRIBUTOR',
  FIRST_TIME_CONTRIBUTOR = 'FIRST_TIME_CONTRIBUTOR',
  FIRST_TIMER = 'FIRST_TIMER',
  MEMBER = 'MEMBER',
  OWNER = 'OWNER',
  NONE = 'NONE'
}

const collaboratorAssociation: CommentAuthorAssociation[] = [
  CommentAuthorAssociation.COLLABORATOR,
  CommentAuthorAssociation.MEMBER,
  CommentAuthorAssociation.OWNER
]

/**
 * Is this a pull request event?
 *
 * @param payload - GitHub action event payload.
 * @returns `true` if it's a PR.
 */
const isPullRequest = (
  payload: Record<string, unknown>
): payload is {
  pull_request: {
    number: number
  }
} => payload.pull_request !== undefined

/**
 * Is this a pull request review event?
 *
 * @param payload - GitHub action event payload.
 * @returns `true` if it's a PR review.
 */
const isPullRequestReview = (
  payload: Record<string, unknown>
): payload is {
  pull_request_review: {
    pull_request: {
      number: number
    }
  }
} => payload.pull_request_review !== undefined

// Run the action
run()
