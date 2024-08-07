import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/datarooms/:id/folders/documents/:name
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const userId = (session.user as CustomUser).id;
    const {
      teamId,
      id: dataroomId,
      name,
    } = req.query as { teamId: string; id: string; name: string[] };

    const path = "/" + name.join("/"); // construct the materialized path

    try {
      // Check if the user is part of the team
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: {
              userId: userId,
            },
          },
        },
      });

      if (!team) {
        return res.status(401).end("Unauthorized");
      }

      const folder = await prisma.dataroomFolder.findUnique({
        where: {
          dataroomId_path: {
            dataroomId,
            path,
          },
        },
        select: {
          id: true,
          parentId: true,
        },
      });

      if (!folder) {
        return res.status(404).end("Folder not found");
      }

      const documents = await prisma.dataroomDocument.findMany({
        where: {
          dataroomId: dataroomId,
          folderId: folder.id,
        },
        orderBy: {
          document: {
            name: "asc",
          },
        },
        select: {
          id: true,
          dataroomId: true,
          folderId: true,
          createdAt: true,
          updatedAt: true,
          document: {
            select: {
              id: true,
              name: true,
              type: true,
              _count: {
                select: {
                  views: { where: { viewType: "DATAROOM_VIEW" } },
                  versions: true,
                },
              },
            },
          },
        },
      });

      // Sort documents by name considering the numerical part
      documents.sort((a, b) => {
        const getNumber = (str: string): number => {
          const match = str.match(/^\d+/);
          return match ? parseInt(match[0], 10) : 0;
        };

        const numA = getNumber(a.document.name);
        const numB = getNumber(b.document.name);

        if (numA !== numB) {
          return numA - numB;
        }

        // If numerical parts are the same, fall back to lexicographical order
        return a.document.name.localeCompare(b.document.name);
      });

      return res.status(200).json(documents);
    } catch (error) {
      console.error("Request error", error);
      return res
        .status(500)
        .json({ error: "Error fetching dataroom folder documents" });
    }
  } else {
    // We only allow GET requests
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
