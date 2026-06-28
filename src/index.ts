#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import { IgApiClient } from 'instagram-private-api';
import * as dotenv from 'dotenv';
import http from 'http';

// Load environment variables
dotenv.config();

// Instagram API credentials
const INSTAGRAM_USERNAME = process.env.INSTAGRAM_USERNAME;
const INSTAGRAM_PASSWORD = process.env.INSTAGRAM_PASSWORD;

// Validate required environment variables
if (!INSTAGRAM_USERNAME || !INSTAGRAM_PASSWORD) {
  console.error('[Error] Missing required environment variables: INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD');
  process.exit(1);
}

// Type definitions for our tools
interface AnalyzeCommentsArgs {
  postUrl: string;
  maxComments?: number;
}

interface CompareAccountsArgs {
  accounts: string[];
  metrics?: string[];
}

interface ExtractDemographicsArgs {
  accountOrPostUrl: string;
  sampleSize?: number;
}

interface IdentifyLeadsArgs {
  accountOrPostUrl: string;
  criteria?: {
    minComments?: number;
    minFollowers?: number;
    keywords?: string[];
  };
}

interface GenerateReportArgs {
  account: string;
  startDate?: string;
  endDate?: string;
}

interface FindPayingClientLeadsArgs {
  sourceAccounts: string[];
  maxCommentsPerPost?: number;
  maxPostsPerAccount?: number;
  niche?: string;
}

// Utility function to validate post URL
const isValidPostUrl = (url: string): boolean => {
  return /^https:\/\/(www\.)?instagram\.com\/p\/[A-Za-z0-9_-]+\/?/.test(url);
};

// Utility function to extract post ID from URL
const extractPostIdFromUrl = (url: string): string => {
  const match = url.match(/\/p\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : '';
};

// Utility function to validate Instagram username
const isValidUsername = (username: string): boolean => {
  return /^[A-Za-z0-9._]+$/.test(username);
};

class InstagramEngagementServer {
  private server: Server;
  private ig: IgApiClient;
  private isLoggedIn: boolean = false;

  constructor() {
    console.error('[Setup] Initializing Instagram Engagement MCP server...');
    
    this.server = new Server(
      {
        name: 'instagram-engagement-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.ig = new IgApiClient();
    
    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private async loginToInstagram(): Promise<boolean> {
    if (this.isLoggedIn) return true;
    
    // Add retry logic or more robust error handling if needed
    try {
      console.error('[Auth] Attempting to log in to Instagram...');
      this.ig.state.generateDevice(INSTAGRAM_USERNAME!);
      // Optional: Add proxy support if needed
      // this.ig.state.proxyUrl = process.env.IG_PROXY; 
      await this.ig.account.login(INSTAGRAM_USERNAME!, INSTAGRAM_PASSWORD!);
      this.isLoggedIn = true;
      console.error('[Auth] Successfully logged in to Instagram');
      return true;
    } catch (error: any) {
      console.error('[Auth Error] Failed to log in to Instagram:', error.message || error);
      // Consider specific error handling (e.g., ChallengeRequiredError)
      return false;
    }
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'analyze_post_comments',
          description: 'Analyze comments on an Instagram post to identify sentiment, themes, and potential leads',
          inputSchema: {
            type: 'object',
            properties: {
              postUrl: {
                type: 'string',
                description: 'URL of the Instagram post to analyze',
              },
              maxComments: {
                type: 'number',
                description: 'Maximum number of comments to analyze (default: 100)',
              },
            },
            required: ['postUrl'],
          },
        },
        {
          name: 'compare_accounts',
          description: 'Compare engagement metrics across different Instagram accounts',
          inputSchema: {
            type: 'object',
            properties: {
              accounts: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'List of Instagram account handles to compare',
              },
              metrics: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['followers', 'engagement', 'posts', 'comments', 'likes'],
                },
                description: 'Metrics to compare (default: all)',
              },
            },
            required: ['accounts'],
          },
        },
        {
          name: 'extract_demographics',
          description: 'Extract demographic insights from users engaged with a post or account',
          inputSchema: {
            type: 'object',
            properties: {
              accountOrPostUrl: {
                type: 'string',
                description: 'Instagram account handle or post URL to analyze',
              },
              sampleSize: {
                type: 'number',
                description: 'Number of users to sample for demographic analysis (default: 50)',
              },
            },
            required: ['accountOrPostUrl'],
          },
        },
        {
          name: 'identify_leads',
          description: 'Identify potential leads based on engagement patterns',
          inputSchema: {
            type: 'object',
            properties: {
              accountOrPostUrl: {
                type: 'string',
                description: 'Instagram account handle or post URL to analyze',
              },
              criteria: {
                type: 'object',
                properties: {
                  minComments: {
                    type: 'number',
                    description: 'Minimum number of comments from a user',
                  },
                  minFollowers: {
                    type: 'number',
                    description: 'Minimum number of followers a user should have',
                  },
                  keywords: {
                    type: 'array',
                    items: {
                      type: 'string',
                    },
                    description: 'Keywords to look for in user comments or bio',
                  },
                },
                description: 'Criteria for identifying leads',
              },
            },
            required: ['accountOrPostUrl'],
          },
        },
        {
          name: 'generate_engagement_report',
          description: 'Generate a comprehensive engagement report for an Instagram account',
          inputSchema: {
            type: 'object',
            properties: {
              account: {
                type: 'string',
                description: 'Instagram account handle',
              },
              startDate: {
                type: 'string',
                description: 'Start date for the report (YYYY-MM-DD)',
              },
              endDate: {
                type: 'string',
                description: 'End date for the report (YYYY-MM-DD)',
              },
            },
            required: ['account'],
          },
        },
        {
          name: 'find_paying_client_leads',
          description: 'Scan recent posts on one or more Instagram accounts and surface commenters who show high-intent buying signals for fitness/fat-loss coaching — questions about pricing, programs, how to sign up, transformation desire, or frustration with current results. Returns a ranked lead list with their username, signal score, matched phrases, and a suggested DM opener.',
          inputSchema: {
            type: 'object',
            properties: {
              sourceAccounts: {
                type: 'array',
                items: { type: 'string' },
                description: 'Instagram account handles whose recent posts will be scanned (e.g. ["fat.loss.operator", "competitor_account"])',
              },
              maxCommentsPerPost: {
                type: 'number',
                description: 'Max comments to scan per post (default: 200)',
              },
              maxPostsPerAccount: {
                type: 'number',
                description: 'How many recent posts to scan per account (default: 10)',
              },
              niche: {
                type: 'string',
                description: 'Coaching niche to tune signal keywords (default: "fat loss coaching")',
              },
            },
            required: ['sourceAccounts'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      console.error(`[Tool] Request to execute tool: ${request.params.name}`);
      
      // Ensure we're logged in to Instagram
      const loggedIn = await this.loginToInstagram();
      if (!loggedIn) {
        throw new McpError(
          ErrorCode.InternalError,
          'Failed to authenticate with Instagram'
        );
      }

      const args = request.params.arguments || {};
      
      try {
        switch (request.params.name) {
          case 'analyze_post_comments':
            return await this.handleAnalyzePostComments(args as unknown as AnalyzeCommentsArgs);
          case 'compare_accounts':
            return await this.handleCompareAccounts(args as unknown as CompareAccountsArgs);
          case 'extract_demographics':
            return await this.handleExtractDemographics(args as unknown as ExtractDemographicsArgs);
          case 'identify_leads':
            return await this.handleIdentifyLeads(args as unknown as IdentifyLeadsArgs);
          case 'generate_engagement_report':
            return await this.handleGenerateReport(args as unknown as GenerateReportArgs);
          case 'find_paying_client_leads':
            return await this.handleFindPayingClientLeads(args as unknown as FindPayingClientLeadsArgs);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Tool ${request.params.name} not found`);
        }
      } catch (error: any) {
        console.error(`[Tool Error] Error executing tool ${request.params.name}:`, error.message || error);
        if (error instanceof McpError) {
          throw error;
        }
        // Map specific API errors to MCP errors
        if (error.name === 'IgNotFoundError') {
          throw new McpError(ErrorCode.InvalidParams, `Instagram resource not found: ${error.message}`);
        }
        if (error.name === 'IgLoginRequiredError' || error.name === 'IgCheckpointError') {
          this.isLoggedIn = false; // Force re-login on next attempt
          throw new McpError(ErrorCode.InternalError, `Instagram login required or challenge encountered: ${error.message}`);
        }
        if (error.name === 'IgRequestsLimitError') {
          throw new McpError(ErrorCode.InternalError, `Instagram rate limit hit: ${error.message}`);
        }
        // Generic internal error for other cases
        throw new McpError(ErrorCode.InternalError, `An unexpected error occurred while executing the tool: ${error.message || 'Unknown error'}`);
      }
    });
  }

  private async handleAnalyzePostComments(args: AnalyzeCommentsArgs) {
    console.error('[Tool] handleAnalyzePostComments called with args:', args);
    const { postUrl, maxComments = 100 } = args;

    if (!isValidPostUrl(postUrl)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid post URL format.');
    }

    const mediaId = await this.getMediaIdFromUrl(postUrl);
    if (!mediaId) {
      throw new McpError(ErrorCode.InvalidParams, 'Could not extract media ID from post URL.');
    }
    
    console.error(`[Tool] Analyzing comments for media ID: ${mediaId}`);

    try {
      const commentsFeed = this.ig.feed.mediaComments(mediaId);
      let comments: any[] = [];
      let commentCount = 0;
      
      // Basic pagination handling
      do {
          const items = await commentsFeed.items();
          comments = comments.concat(items);
          commentCount += items.length;
          console.error(`[Tool] Fetched ${items.length} comments (total: ${commentCount})`);
          if (commentCount >= maxComments) break;
          await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500)); // Small delay
      } while (commentsFeed.isMoreAvailable());
      
      comments = comments.slice(0, maxComments); // Trim to maxComments

      console.error(`[Tool] Analyzing ${comments.length} comments.`);

      // Basic analysis (replace with more sophisticated logic if needed)
      const analysis = {
        totalCommentsFetched: comments.length,
        // Placeholder for sentiment/themes - requires NLP library
        sentiment: 'neutral', 
        topThemes: ['general', 'engagement'],
        potentialLeads: comments.filter(c => c.text.includes('interested') || c.text.includes('DM')).map(c => ({
          username: c.user.username,
          comment: c.text.substring(0, 100), // Truncate long comments
        })),
        sampleComments: comments.slice(0, 5).map(c => ({
          username: c.user.username,
          text: c.text.substring(0, 100),
          timestamp: new Date(c.created_at_utc * 1000).toISOString(),
        })),
      };

      return { results: analysis };
    } catch (error: any) {
      console.error(`[API Error] Failed to analyze comments for ${mediaId}:`, error.message || error);
      // Re-throw as McpError or handle specifically
      if (error.name === 'IgNotFoundError') {
          throw new McpError(ErrorCode.InvalidParams, `Post with media ID ${mediaId} not found or access denied.`);
      }
      throw new McpError(ErrorCode.InternalError, `Failed to fetch or analyze comments: ${error.message}`);
    }
  }

  private async handleCompareAccounts(args: CompareAccountsArgs) {
    console.error('[Tool] handleCompareAccounts called with args:', args);
    const { accounts, metrics = ['followers', 'engagement', 'posts'] } = args;

    if (!accounts || accounts.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'At least one account handle must be provided.');
    }
    if (accounts.some(acc => !isValidUsername(acc))) {
        throw new McpError(ErrorCode.InvalidParams, 'One or more account handles are invalid.');
    }

    const comparisonResults: any = {};

    for (const username of accounts) {
      console.error(`[Tool] Fetching data for account: ${username}`);
      try {
        const userId = await this.ig.user.getIdByUsername(username);
        const userInfo = await this.ig.user.info(userId);
        
        // Basic metrics calculation
        const followerCount = userInfo.follower_count;
        const followingCount = userInfo.following_count;
        const postCount = userInfo.media_count;
        
        // Placeholder for engagement - requires fetching recent posts and calculating average likes/comments
        let engagementRate = 0; 
        if (followerCount > 0) {
            // Fetch recent posts - limited scope for example
            const postsFeed = this.ig.feed.user(userId);
            const recentPosts = await postsFeed.items(); 
            if (recentPosts.length > 0) {
                const totalLikes = recentPosts.reduce((sum, post) => sum + (post.like_count || 0), 0);
                const totalComments = recentPosts.reduce((sum, post) => sum + (post.comment_count || 0), 0);
                const avgLikes = totalLikes / recentPosts.length;
                const avgComments = totalComments / recentPosts.length;
                engagementRate = ((avgLikes + avgComments) / followerCount) * 100;
            }
        }

        comparisonResults[username] = {
          userId: userId,
          fullName: userInfo.full_name,
          isPrivate: userInfo.is_private,
          isVerified: userInfo.is_verified,
          followers: metrics.includes('followers') ? followerCount : undefined,
          following: metrics.includes('following') ? followingCount : undefined, // Added following as potential metric
          posts: metrics.includes('posts') ? postCount : undefined,
          engagementRate: metrics.includes('engagement') ? parseFloat(engagementRate.toFixed(2)) : undefined, // Simplified engagement
          // 'likes' and 'comments' metrics would typically be per post, not overall account.
        };
        console.error(`[Tool] Successfully fetched data for ${username}`);
        await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 400)); // Small delay

      } catch (error: any) {
        console.error(`[API Error] Failed to get info for account ${username}:`, error.message || error);
        comparisonResults[username] = { error: `Failed to fetch data: ${error.message}` };
        if (error.name === 'IgNotFoundError') {
             comparisonResults[username] = { error: 'Account not found.' };
        }
      }
    }

    return { results: comparisonResults };
  }

  private async handleExtractDemographics(args: ExtractDemographicsArgs) {
    console.error('[Tool] handleExtractDemographics called with args:', args);
    const { accountOrPostUrl, sampleSize = 50 } = args;

    // Determine if it's a post URL or username
    let targetId: string; 
    let targetType: 'account' | 'post';

    if (isValidPostUrl(accountOrPostUrl)) {
      targetType = 'post';
      const mediaId = await this.getMediaIdFromUrl(accountOrPostUrl);
      if (!mediaId) {
          throw new McpError(ErrorCode.InvalidParams, 'Could not extract media ID from post URL.');
      }
      targetId = mediaId;
      console.error(`[Tool] Extracting demographics from post: ${targetId}`);

    } else if (isValidUsername(accountOrPostUrl)) {
      targetType = 'account';
      try {
          const userId = await this.ig.user.getIdByUsername(accountOrPostUrl);
          targetId = String(userId); // Convert number userId to string for targetId
          console.error(`[Tool] Extracting demographics from account followers: ${accountOrPostUrl} (ID: ${targetId})`);
      } catch(e: any) {
          if (e.name === 'IgNotFoundError') {
               throw new McpError(ErrorCode.InvalidParams, `Account ${accountOrPostUrl} not found.`);
          }
          throw new McpError(ErrorCode.InternalError, `Failed to get user ID for ${accountOrPostUrl}: ${e.message}`);
      }
    } else {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid input. Provide a valid Instagram username or post URL.');
    }

    try {
        let users: any[] = [];

        if (targetType === 'post') {
            // Get likers or commenters as sample
            console.error(`[Tool Debug] Attempting to fetch likers for media ID: ${targetId}`);
            const likersResponse = await this.ig.media.likers(targetId); 
            let fetchedUsers: any[] = likersResponse.users || []; // Access users from the response object

            // Manual pagination simulation (if needed and possible, likers might not support feed pagination)
            // The private API might not offer easy pagination for likers beyond the initial batch.
            // For simplicity, we'll just use the first batch returned.
            /* 
            let fetchedUsers: any[] = [];
            do {
                 // Feed results are usually directly items
                 const items = await likersFeed.items();
                 fetchedUsers = fetchedUsers.concat(items);
                 if (fetchedUsers.length >= sampleSize) break;
                 await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300)); 
            } while (likersFeed.isMoreAvailable());
            */
            users = fetchedUsers.slice(0, sampleSize);
            console.error(`[Tool] Fetched ${users.length} likers from post ${targetId}`);
        } else { // targetType === 'account'
            const userIdNum = parseInt(targetId, 10);
            const followersFeed = this.ig.feed.accountFollowers(userIdNum);
            let fetchedUsers: any[] = [];
            do {
                const items = await followersFeed.items();
                fetchedUsers = fetchedUsers.concat(items);
                if (fetchedUsers.length >= sampleSize) break;
                 await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300)); 
            } while (followersFeed.isMoreAvailable());
             users = fetchedUsers.slice(0, sampleSize);
             console.error(`[Tool] Fetched ${users.length} followers from account ${accountOrPostUrl}`);
        }

        if (users.length === 0) {
             return { results: { message: 'No users found to analyze (post might have no likes/comments, or account has no followers/is private).', demographics: {} } };
        }

        // Placeholder for actual demographic analysis
        const demographics = {
            sampleAnalyzed: users.length,
            commonLocationsGuess: ['Unknown'], 
            genderDistributionGuess: { male: 0.4, female: 0.4, unknown: 0.2 },
            accountTypes: { 
                private: users.filter(u => u.is_private).length / users.length,
                verified: users.filter(u => u.is_verified).length / users.length,
            },
            sampleUserProfiles: users.slice(0, 5).map(u => ({ 
                 username: u.username,
                 fullName: u.full_name,
                 isPrivate: u.is_private,
            }))
        };

        return { results: { demographics } };

    } catch (error: any) {
      console.error(`[API Error] Failed to extract demographics for ${accountOrPostUrl}:`, error.message || error);
      if (error.name === 'IgNotFoundError') {
          throw new McpError(ErrorCode.InvalidParams, `${targetType === 'post' ? 'Post' : 'Account'} not found or access denied.`);
      }
      throw new McpError(ErrorCode.InternalError, `Failed to fetch users for demographic analysis: ${error.message}`);
    }
  }

  private async handleIdentifyLeads(args: IdentifyLeadsArgs) {
    console.error('[Tool] handleIdentifyLeads called with args:', args);
    const { accountOrPostUrl, criteria = {} } = args;
    const { minComments, minFollowers, keywords } = criteria;

    let targetId: string;
    let targetType: 'account' | 'post';
    let sourceDescription: string;

     if (isValidPostUrl(accountOrPostUrl)) {
        targetType = 'post';
        const mediaId = await this.getMediaIdFromUrl(accountOrPostUrl);
        if (!mediaId) {
            throw new McpError(ErrorCode.InvalidParams, 'Could not extract media ID from post URL.');
        }
        targetId = mediaId;
        sourceDescription = `comments on post ${targetId}`;
        console.error(`[Tool] Identifying leads from post: ${targetId}`);

    } else if (isValidUsername(accountOrPostUrl)) {
        targetType = 'account';
        try {
            const userId = await this.ig.user.getIdByUsername(accountOrPostUrl);
            targetId = String(userId); // Convert number userId to string for targetId
            sourceDescription = `followers of account ${accountOrPostUrl}`;
             console.error(`[Tool] Identifying leads from account followers: ${accountOrPostUrl} (ID: ${targetId})`);
        } catch(e: any) {
            if (e.name === 'IgNotFoundError') {
                 throw new McpError(ErrorCode.InvalidParams, `Account ${accountOrPostUrl} not found.`);
            }
            throw new McpError(ErrorCode.InternalError, `Failed to get user ID for ${accountOrPostUrl}: ${e.message}`);
        }
    } else {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid input. Provide a valid Instagram username or post URL.');
    }


    try {
        let potentialLeads: any[] = [];
        // Use Map with string key (user PK converted to string)
        let usersToAnalyze: Map<string, any> = new Map(); 

         if (targetType === 'post') {
             const commentsFeed = this.ig.feed.mediaComments(targetId);
             const comments = await commentsFeed.items(); 
              console.error(`[Tool] Fetched ${comments.length} comments for lead analysis.`);
             comments.forEach(comment => {
                 const userPkStr = String(comment.user.pk);
                 if (!usersToAnalyze.has(userPkStr)) {
                     usersToAnalyze.set(userPkStr, { ...comment.user, comments: [comment.text] });
                 } else {
                     usersToAnalyze.get(userPkStr).comments.push(comment.text);
                 }
             });
         } else { // targetType === 'account'
             const userIdNum = parseInt(targetId, 10);
             const followersFeed = this.ig.feed.accountFollowers(userIdNum);
             const followers = await followersFeed.items();
             console.error(`[Tool] Fetched ${followers.length} followers for lead analysis.`);
             followers.forEach(follower => {
                 const followerPkStr = String(follower.pk);
                 if (!usersToAnalyze.has(followerPkStr)) {
                     usersToAnalyze.set(followerPkStr, { ...follower, comments: [] }); 
                 }
             });
         }

        console.error(`[Tool] Analyzing ${usersToAnalyze.size} unique users from ${sourceDescription}.`);
        
        for (const user of usersToAnalyze.values()) {
            let meetsCriteria = true;
            let reasons: string[] = [];

            let userInfo = user;
            if ( (minFollowers && !userInfo.follower_count) || (keywords && !userInfo.biography)) {
                 try {
                     if (user.pk) {
                         userInfo = await this.ig.user.info(user.pk);
                         await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200)); 
                     } else {
                         console.warn(`[Tool] Skipping detailed check for user without pk: ${user.username || 'Unknown'}`);
                         continue; 
                     }
                 } catch (infoError: any) {
                     console.warn(`[Tool] Could not fetch full info for user ${user.username || user.pk}: ${infoError.message}`);
                     if (minFollowers && !userInfo.follower_count) {
                         continue;
                     }
                 }
            }

            if (minFollowers && (userInfo.follower_count === undefined || userInfo.follower_count < minFollowers)) {
                meetsCriteria = false;
            } else if (minFollowers) {
                 reasons.push(`Followers: ${userInfo.follower_count} (>=${minFollowers})`);
            }

            const userCommentCount = user.comments?.length || 0;
            if (minComments && userCommentCount < minComments) {
                 meetsCriteria = false;
            } else if (minComments) {
                 reasons.push(`Comments: ${userCommentCount} (>=${minComments})`);
            }
           
            if (keywords && keywords.length > 0) {
                const bio = userInfo.biography || '';
                const commentsText = (user.comments || []).join(' ').toLowerCase();
                const bioLower = bio.toLowerCase();
                
                const foundKeywords = keywords.filter(kw => bioLower.includes(kw.toLowerCase()) || commentsText.includes(kw.toLowerCase()));
                
                if (foundKeywords.length === 0) {
                    meetsCriteria = false;
                } else {
                    reasons.push(`Keywords found: [${foundKeywords.join(', ')}]`);
                }
            }

            if (meetsCriteria) {
                potentialLeads.push({
                    username: userInfo.username,
                    userId: userInfo.pk,
                    fullName: userInfo.full_name,
                    followerCount: userInfo.follower_count,
                    isPrivate: userInfo.is_private,
                    reasons: reasons, 
                    sampleComment: user.comments?.[0]?.substring(0, 100) 
                });
            }
        }

        console.error(`[Tool] Identified ${potentialLeads.length} potential leads.`);
        return { results: { leads: potentialLeads.slice(0, 50) } }; 

    } catch (error: any) {
      console.error(`[API Error] Failed to identify leads for ${accountOrPostUrl}:`, error.message || error);
      if (error.name === 'IgNotFoundError') {
          throw new McpError(ErrorCode.InvalidParams, `${targetType === 'post' ? 'Post' : 'Account'} not found or access denied.`);
      }
      throw new McpError(ErrorCode.InternalError, `Failed to process lead identification: ${error.message}`);
    }
  }

  private async handleGenerateReport(args: GenerateReportArgs) {
    console.error('[Tool] handleGenerateReport called with args:', args);
    const { account, startDate, endDate } = args;

     if (!isValidUsername(account)) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid account handle.');
    }

    try {
        const userId = await this.ig.user.getIdByUsername(account);
        const userInfo = await this.ig.user.info(userId);

        console.error(`[Tool] Generating report for account: ${account} (ID: ${userId})`);

        const postsFeed = this.ig.feed.user(userId);
        let allPosts: any[] = [];
        let recentPosts: any[] = [];
        
        let postCount = 0;
        const maxPostsToFetch = 200; 
        do {
            const items = await postsFeed.items();
            allPosts = allPosts.concat(items);
            postCount += items.length;
            if (postCount >= maxPostsToFetch) break; 
            console.error(`[Tool] Fetched ${items.length} posts (total: ${postCount}) for report`);
            await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300)); 
        } while (postsFeed.isMoreAvailable() && postCount < maxPostsToFetch);

        const start = startDate ? new Date(startDate).getTime() / 1000 : null;
        const end = endDate ? new Date(endDate).getTime() / 1000 + (24 * 60 * 60 -1) : null; 

        recentPosts = allPosts.filter(post => {
            const postTimestamp = post.taken_at; 
            const isAfterStart = start ? postTimestamp >= start : true;
            const isBeforeEnd = end ? postTimestamp <= end : true;
            return isAfterStart && isBeforeEnd;
        });

         console.error(`[Tool] Found ${recentPosts.length} posts within date range (out of ${allPosts.length} fetched).`);
         
         if (recentPosts.length === 0) {
              return { results: { 
                  message: `No posts found for ${account} in the specified period.`,
                  accountInfo: { username: account, followers: userInfo.follower_count },
                  period: { startDate, endDate },
                  summary: { totalPosts: 0, totalLikes: 0, totalComments: 0, avgEngagementRate: 0 } 
              }};
         }

        const totalLikes = recentPosts.reduce((sum, post) => sum + (post.like_count || 0), 0);
        const totalComments = recentPosts.reduce((sum, post) => sum + (post.comment_count || 0), 0);
        const avgLikesPerPost = totalLikes / recentPosts.length;
        const avgCommentsPerPost = totalComments / recentPosts.length;
        const followerCount = userInfo.follower_count;
        const avgEngagementRate = followerCount > 0 ? ((avgLikesPerPost + avgCommentsPerPost) / followerCount) * 100 : 0;

        const topPostsByLikes = [...recentPosts]
            .sort((a, b) => (b.like_count || 0) - (a.like_count || 0))
            .slice(0, 3)
            .map(p => ({
                url: `https://www.instagram.com/p/${p.code}/`,
                likes: p.like_count,
                comments: p.comment_count,
                caption: p.caption?.text.substring(0, 50) + '...' || '[No Caption]',
                timestamp: new Date(p.taken_at * 1000).toISOString()
            }));

        const report = {
            accountInfo: {
                username: account,
                fullName: userInfo.full_name,
                followers: followerCount,
                following: userInfo.following_count,
                totalPosts: userInfo.media_count,
                bio: userInfo.biography,
                isPrivate: userInfo.is_private,
            },
            period: {
                startDate: startDate || 'N/A',
                endDate: endDate || 'N/A',
                postsAnalyzed: recentPosts.length,
            },
            summary: {
                totalLikes: totalLikes,
                totalComments: totalComments,
                avgLikesPerPost: parseFloat(avgLikesPerPost.toFixed(2)),
                avgCommentsPerPost: parseFloat(avgCommentsPerPost.toFixed(2)),
                avgEngagementRate: parseFloat(avgEngagementRate.toFixed(2)), 
            },
            topPostsByLikes: topPostsByLikes,
        };

        return { results: report };

    } catch (error: any) {
      console.error(`[API Error] Failed to generate report for ${account}:`, error.message || error);
      if (error.name === 'IgNotFoundError') {
          throw new McpError(ErrorCode.InvalidParams, `Account ${account} not found.`);
      }
      throw new McpError(ErrorCode.InternalError, `Failed to generate engagement report: ${error.message}`);
    }
  }
  
   private async handleFindPayingClientLeads(args: FindPayingClientLeadsArgs) {
    console.error('[Tool] handleFindPayingClientLeads called with args:', args);
    const {
      sourceAccounts,
      maxCommentsPerPost = 200,
      maxPostsPerAccount = 10,
      niche = 'fat loss coaching',
    } = args;

    if (!sourceAccounts || sourceAccounts.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'At least one source account must be provided.');
    }

    // Buying-signal phrases weighted by intent level (3 = hottest)
    const SIGNAL_PHRASES: { phrase: string; weight: number; category: string }[] = [
      // Direct purchase intent
      { phrase: 'how much', weight: 3, category: 'price inquiry' },
      { phrase: 'what does it cost', weight: 3, category: 'price inquiry' },
      { phrase: 'how do i sign up', weight: 3, category: 'sign-up intent' },
      { phrase: 'how do i join', weight: 3, category: 'sign-up intent' },
      { phrase: 'where do i sign up', weight: 3, category: 'sign-up intent' },
      { phrase: 'take my money', weight: 3, category: 'sign-up intent' },
      { phrase: 'i need this', weight: 3, category: 'sign-up intent' },
      { phrase: 'i want to join', weight: 3, category: 'sign-up intent' },
      { phrase: 'dm me', weight: 3, category: 'dm request' },
      { phrase: 'dm me please', weight: 3, category: 'dm request' },
      { phrase: 'send me info', weight: 3, category: 'info request' },
      { phrase: 'send me details', weight: 3, category: 'info request' },
      { phrase: 'do you have a program', weight: 3, category: 'program inquiry' },
      { phrase: 'do you offer coaching', weight: 3, category: 'coaching inquiry' },
      { phrase: 'are you taking clients', weight: 3, category: 'coaching inquiry' },
      // High frustration / transformation desire
      { phrase: 'nothing is working', weight: 2, category: 'frustration' },
      { phrase: 'nothing works for me', weight: 2, category: 'frustration' },
      { phrase: 'i give up', weight: 2, category: 'frustration' },
      { phrase: "can't lose weight", weight: 2, category: 'frustration' },
      { phrase: 'stuck at', weight: 2, category: 'plateau' },
      { phrase: 'plateau', weight: 2, category: 'plateau' },
      { phrase: 'i need help', weight: 2, category: 'help request' },
      { phrase: 'help me', weight: 2, category: 'help request' },
      { phrase: 'need a coach', weight: 2, category: 'coaching inquiry' },
      { phrase: 'looking for a coach', weight: 2, category: 'coaching inquiry' },
      { phrase: 'want results like this', weight: 2, category: 'transformation desire' },
      { phrase: 'goals', weight: 1, category: 'aspiration' },
      { phrase: 'transformation', weight: 1, category: 'transformation desire' },
      { phrase: 'motivat', weight: 1, category: 'aspiration' },
      { phrase: 'inspired', weight: 1, category: 'aspiration' },
      { phrase: 'how did you do this', weight: 2, category: 'transformation inquiry' },
      { phrase: 'what did you do', weight: 2, category: 'transformation inquiry' },
      { phrase: 'what program', weight: 2, category: 'program inquiry' },
      { phrase: 'what plan', weight: 2, category: 'program inquiry' },
      { phrase: 'starting my journey', weight: 2, category: 'new prospect' },
      { phrase: 'just started', weight: 1, category: 'new prospect' },
      { phrase: 'lose weight', weight: 1, category: 'fat loss goal' },
      { phrase: 'lose fat', weight: 1, category: 'fat loss goal' },
      { phrase: 'weight loss', weight: 1, category: 'fat loss goal' },
      { phrase: 'fat loss', weight: 1, category: 'fat loss goal' },
      { phrase: 'get lean', weight: 1, category: 'fat loss goal' },
    ];

    const DM_OPENERS: Record<string, string> = {
      'price inquiry': "Hey [name]! Saw your comment — happy to share all the details. What's your main goal right now?",
      'sign-up intent': "Hey [name]! Love the energy 🔥 Let me shoot you the info on how we get started. What does your current routine look like?",
      'dm request': "Hey [name]! Sliding in as requested 😄 What's the #1 thing you're struggling with right now?",
      'info request': "Hey [name]! Dropping the details your way — quick question first: how long have you been trying to lose the weight?",
      'coaching inquiry': "Hey [name]! Yes, I'm taking on new clients right now. Tell me a bit about where you're at and what you've already tried.",
      'frustration': "Hey [name]! I saw your comment and I get it — it's exhausting when nothing seems to work. That's exactly why I do what I do. Mind if I ask a couple questions?",
      'plateau': "Hey [name]! Plateaus are the worst — but they're also very fixable. I'd love to take a look at what you've been doing. Want me to walk you through it?",
      'help request': "Hey [name]! I've got you. What specifically are you struggling with most right now — nutrition, training, consistency, or something else?",
      'transformation desire': "Hey [name]! Results like that are 100% possible for you too. I'd love to show you exactly how. What's your current situation like?",
      'transformation inquiry': "Hey [name]! Happy to break it all down for you! The process is simpler than most people think. Want me to send you a quick overview?",
      'program inquiry': "Hey [name]! Yes! I have a program built specifically for [niche]. Want me to send you the details?",
      'fat loss goal': "Hey [name]! Noticed your comment — [niche] is literally what I specialize in. Are you working with anyone right now or going it alone?",
      'new prospect': "Hey [name]! Love that you're starting your journey — the beginning is actually the easiest time to get real results. Want some guidance?",
      'aspiration': "Hey [name]! So glad this resonated with you 🙌 If you ever want a clear path to get there yourself, I'd love to help. What's your goal?",
      default: "Hey [name]! Noticed your comment and wanted to reach out. What's your main goal right now when it comes to [niche]?",
    };

    // Aggregate leads across all accounts: username -> lead data
    const leadMap = new Map<string, {
      username: string;
      userId: string;
      score: number;
      matchedPhrases: string[];
      categories: Set<string>;
      topCategory: string;
      sampleComment: string;
      sourcePost: string;
      sourceAccount: string;
    }>();

    for (const account of sourceAccounts) {
      if (!isValidUsername(account)) {
        console.error(`[Tool] Skipping invalid account handle: ${account}`);
        continue;
      }

      let userId: number;
      try {
        userId = await this.ig.user.getIdByUsername(account);
      } catch (e: any) {
        console.error(`[Tool] Could not resolve user ID for ${account}: ${e.message}`);
        continue;
      }

      const postsFeed = this.ig.feed.user(userId);
      let postsFetched = 0;

      while (postsFetched < maxPostsPerAccount) {
        let batch: any[];
        try {
          batch = await postsFeed.items();
        } catch (e: any) {
          console.error(`[Tool] Failed to fetch posts for ${account}: ${e.message}`);
          break;
        }
        if (!batch.length) break;

        for (const post of batch) {
          if (postsFetched >= maxPostsPerAccount) break;
          postsFetched++;

          const postShortcode = post.code;
          const postUrl = `https://www.instagram.com/p/${postShortcode}/`;

          const commentsFeed = this.ig.feed.mediaComments(String(post.pk));
          let commentsFetched = 0;

          while (commentsFetched < maxCommentsPerPost) {
            let commentBatch: any[];
            try {
              commentBatch = await commentsFeed.items();
            } catch (e: any) {
              console.error(`[Tool] Failed to fetch comments for post ${post.pk}: ${e.message}`);
              break;
            }
            if (!commentBatch.length) break;

            for (const comment of commentBatch) {
              if (commentsFetched >= maxCommentsPerPost) break;
              commentsFetched++;

              const text = (comment.text || '').toLowerCase();
              let score = 0;
              const matched: string[] = [];
              const categories = new Set<string>();

              for (const signal of SIGNAL_PHRASES) {
                if (text.includes(signal.phrase)) {
                  score += signal.weight;
                  matched.push(signal.phrase);
                  categories.add(signal.category);
                }
              }

              if (score === 0) continue;

              const username: string = comment.user?.username || 'unknown';
              const existing = leadMap.get(username);
              if (existing) {
                existing.score += score;
                existing.matchedPhrases.push(...matched.filter(p => !existing.matchedPhrases.includes(p)));
                categories.forEach(c => existing.categories.add(c));
              } else {
                leadMap.set(username, {
                  username,
                  userId: String(comment.user?.pk || ''),
                  score,
                  matchedPhrases: [...new Set(matched)],
                  categories,
                  topCategory: '',
                  sampleComment: comment.text.substring(0, 120),
                  sourcePost: postUrl,
                  sourceAccount: account,
                });
              }
            }

            if (!commentsFeed.isMoreAvailable()) break;
            await new Promise(r => setTimeout(r, 300 + Math.random() * 300));
          }

          await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
        }

        if (!postsFeed.isMoreAvailable()) break;
        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      }

      await new Promise(r => setTimeout(r, 600 + Math.random() * 600));
    }

    // Sort by score descending, pick top 50
    const sorted = [...leadMap.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    const leads = sorted.map(lead => {
      // Determine top category by picking the highest-weight matched signal category
      let topCat = 'aspiration';
      let topWeight = 0;
      for (const signal of SIGNAL_PHRASES) {
        if (lead.matchedPhrases.includes(signal.phrase) && signal.weight > topWeight) {
          topWeight = signal.weight;
          topCat = signal.category;
        }
      }

      const opener = (DM_OPENERS[topCat] || DM_OPENERS['default'])
        .replace('[name]', lead.username)
        .replace('[niche]', niche);

      return {
        username: lead.username,
        profileUrl: `https://www.instagram.com/${lead.username}/`,
        signalScore: lead.score,
        intentLevel: lead.score >= 6 ? 'HOT' : lead.score >= 3 ? 'WARM' : 'COOL',
        topCategory: topCat,
        matchedPhrases: lead.matchedPhrases,
        sampleComment: lead.sampleComment,
        sourcePost: lead.sourcePost,
        sourceAccount: lead.sourceAccount,
        suggestedDmOpener: opener,
      };
    });

    const hot = leads.filter(l => l.intentLevel === 'HOT').length;
    const warm = leads.filter(l => l.intentLevel === 'WARM').length;

    return {
      results: {
        summary: {
          totalLeadsFound: leads.length,
          hotLeads: hot,
          warmLeads: warm,
          coolLeads: leads.length - hot - warm,
          accountsScanned: sourceAccounts.length,
          niche,
        },
        leads,
      },
    };
  }

  private async getMediaIdFromUrl(url: string): Promise<string | null> {
     try {
        // Extract shortcode first
        const shortcode = extractPostIdFromUrl(url);
        if (!shortcode) return null;
        
        // Getting the numeric media PK (required by many feed functions) from URL/shortcode is unreliable.
        // Option 1: Use a library method if exists (e.g., getIdFromUrl - hypothetical)
        // Option 2: Use media.info(pk) - but we don't have pk!
        // Option 3: Use media.getByUrl(url) - might exist in some versions
        // Option 4: Return the shortcode and hope feed functions accept it (sometimes works)
        // Option 5: Oembed (public, might give ID)

        let mediaId: string | null = null;
        
        try {
            // Try using getByUrl if it exists in the installed library version
            // @ts-ignore // Ignore potential TS error if method doesn't exist on type
            const mediaInfo = await this.ig.media.getByUrl(url);
            if (mediaInfo && mediaInfo.pk) {
                 console.log(`[Helper] Found media PK ${mediaInfo.pk} using getByUrl for ${url}`);
                 mediaId = mediaInfo.pk; // pk is the numeric ID
            } else {
                 console.warn(`[Helper Warn] ig.media.getByUrl did not return expected info for ${url}.`);
            }
        } catch(lookupError: any) {
            console.warn(`[Helper Warn] Failed to get media PK using getByUrl for ${url}: ${lookupError.message}.`);
            // If getByUrl fails or doesn't exist, fall back to using the shortcode directly.
            // Note: Some feeds (like mediaComments) require the numeric PK and will fail with the shortcode.
            mediaId = shortcode; 
            console.log(`[Helper] Falling back to using shortcode ${shortcode} as media ID for ${url}`);
        }
        
        if (!mediaId) {
           console.error(`[Helper Error] Could not resolve media ID for shortcode: ${shortcode}`);
           return null;
        }
        
        return mediaId;

     } catch (error: any) {
       console.error(`[Helper Error] Failed to get media ID from URL ${url}:`, error.message);
       if (error.name === 'IgNotFoundError') {
           return null;
       }
       return null;
     }
   }

  async run() {
    const port = process.env.PORT ? parseInt(process.env.PORT) : null;

    if (port) {
      // HTTP/SSE mode for claude.ai online connector
      console.error(`[Setup] Starting Instagram Engagement MCP server on HTTP port ${port}...`);
      const transports: Record<string, SSEServerTransport> = {};

      const httpServer = http.createServer(async (req, res) => {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = new URL(req.url || '/', `http://localhost:${port}`);

        if (req.method === 'GET' && url.pathname === '/sse') {
          console.error('[HTTP] New SSE connection');
          const transport = new SSEServerTransport('/message', res);
          transports[transport.sessionId] = transport;

          res.on('close', () => {
            delete transports[transport.sessionId];
            console.error(`[HTTP] SSE connection closed: ${transport.sessionId}`);
          });

          await this.server.connect(transport);
          return;
        }

        if (req.method === 'POST' && url.pathname === '/message') {
          const sessionId = url.searchParams.get('sessionId') || '';
          const transport = transports[sessionId];
          if (!transport) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Session not found' }));
            return;
          }
          await transport.handlePostMessage(req, res);
          return;
        }

        if (url.pathname === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }

        res.writeHead(404);
        res.end();
      });

      httpServer.listen(port, () => {
        console.error(`[Setup] MCP server listening on port ${port}`);
        console.error(`[Setup] SSE endpoint: http://localhost:${port}/sse`);
      });
    } else {
      // stdio mode for local use
      console.error('[Setup] Starting Instagram Engagement MCP server on stdio...');
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('[Setup] Instagram Engagement MCP server running on stdio');
    }
  }
}

const server = new InstagramEngagementServer();
server.run().catch(console.error);
